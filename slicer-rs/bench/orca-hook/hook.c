// An LD_PRELOAD tracer for OrcaSlicer 2.5.1's aarch64 AppImage binary (symbols kept, `nm -C` gives each function's
// address): at each address in HOOK_ADDRS ("<hex vaddr>:<kind>,...") it logs the call's arguments to HOOK_OUT and
// carries on, by putting a `brk` over the function's first instruction (which must not depend on pc) and running a
// copy of that instruction from a trampoline. Kinds, by what the function takes (aarch64: x0 is where a returned
// struct goes, then the arguments):
//   1 TreeSupport3D merge_support_element_states (0x2c3a040): both states, 200 bytes each, and the layer
//   3 RichInterfacePlacer::add_point_as_influence_area (0x2c46cd8): a tip's point and its layer
//   4 TreeSupport3D::sample_overhang_area (0x2c220f4): the overhang's polygons (a Polygon is a vptr and a vector)
//   5 ExPolygon::overlaps (0x220cd64): the contours of both polygons
// Run it with run_orca.sh, on one core (TBB then calls in a fixed order), and not through taskset or env
// with LD_PRELOAD in their own environment (the hook would patch them instead of Orca).
#define _GNU_SOURCE
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
#include <link.h>
#include <stdint.h>
#include <ucontext.h>
#include <pthread.h>
#define MAXH 16
static struct { uintptr_t pc; uint32_t orig; uint32_t *tramp; int kind; } hooks[MAXH];
static int nh; static FILE *out; static pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;
static int cb(struct dl_phdr_info *i, size_t s, void *d) { *(uintptr_t*)d = i->dlpi_addr; return 1; }
static void dump(const char *tag, const void *p, int n) {
  const unsigned char *b = p; fprintf(out, " %s=", tag);
  for (int i = 0; i < n; i++) fprintf(out, "%02x", b[i]);
}
static void handler(int sig, siginfo_t *si, void *ctx) {
  ucontext_t *uc = ctx; uintptr_t pc = uc->uc_mcontext.pc; 
  for (int k = 0; k < nh; k++) if (hooks[k].pc == pc) {
    pthread_mutex_lock(&mu);
    uint64_t *x = (uint64_t*)uc->uc_mcontext.regs;
    fprintf(out, "H%d", hooks[k].kind); 
    if (hooks[k].kind == 1) { // merge_support_element_states(first, second, next_position&, layer_idx, config)
      dump("a", (void*)x[1], 200); dump("b", (void*)x[2], 200); fprintf(out, " l=%ld", (long)(int)x[3]);
    } else if (hooks[k].kind == 3) { // add_point_as_influence_area(this, pair<Point,LineStatus>*, layer, ...)
      dump("p", (void*)x[1], 24); fprintf(out, " l=%d dm=%ld", (int)x[2], (long)x[3]);
    } else if (hooks[k].kind == 4) { // sample_overhang_area(Polygons&&, bool big, layer, roofs, connect_length, settings, placer)
      fprintf(out, " l=%lu big=%d roofs=%lu cl=%ld", (unsigned long)x[2], (int)(x[1]&1), (unsigned long)x[3], (long)x[4]);
      uint64_t *v = (uint64_t*)x[0]; uint64_t *pb = (uint64_t*)v[0], *pe = (uint64_t*)v[1];
      for (; pb < pe; pb += 4) { // each Polygon: vptr, then vector<Point> begin,end,cap
        int64_t *a = (int64_t*)pb[1], *b = (int64_t*)pb[2]; fprintf(out, " P");
        for (; a < b; a += 2) fprintf(out, ";%ld,%ld", (long)a[0], (long)a[1]);
      }
    } else if (hooks[k].kind == 5) { // ExPolygon::overlaps(this, other): contours
      for (int w = 0; w < 2; w++) {
        uint64_t *e = (uint64_t*)x[w]; int64_t *a = (int64_t*)e[1], *b = (int64_t*)e[2];
        if (b - a > 4000) { fprintf(out, " Q"); continue; }
        fprintf(out, " P"); for (; a < b; a += 2) fprintf(out, ";%ld,%ld", (long)a[0], (long)a[1]);
      }
    } else if (hooks[k].kind == 2) { // merge_influence_areas_two_elements(volumes, config, layer_idx, dst&, src&)
      fprintf(out, " l=%ld", (long)x[2]); dump("d", (void*)x[3], 200); dump("s", (void*)x[4], 200);
    }
    fprintf(out, "\n"); fflush(out);
    pthread_mutex_unlock(&mu);
    uc->uc_mcontext.pc = (uintptr_t)hooks[k].tramp; return;
  }
  _exit(99);
}
static void add(uintptr_t base, uintptr_t va, int kind) {
  uintptr_t a = base + va; long ps = sysconf(_SC_PAGESIZE); 
  if (mprotect((void*)(a & ~(ps-1)), ps*2, PROT_READ|PROT_WRITE|PROT_EXEC)) perror("mprotect");
  uint32_t *t = mmap(0, ps, PROT_READ|PROT_WRITE|PROT_EXEC, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0); if (t == MAP_FAILED) perror("mmap");
  hooks[nh].pc = a; hooks[nh].orig = *(uint32_t*)a; hooks[nh].tramp = t; hooks[nh].kind = kind;
  t[0] = hooks[nh].orig; t[1] = 0xd503201f; t[2] = 0x58000050; t[3] = 0xd61f0200; *(uint64_t*)(t+4) = a + 4;
  __builtin___clear_cache((char*)t, (char*)(t+8));
  *(uint32_t*)a = 0xd4200000; __builtin___clear_cache((char*)a, (char*)a+4);
  nh++;
}
__attribute__((constructor)) static void init(void) {
  const char *o = getenv("HOOK_OUT"); out = fopen(o ? o : "/tmp/hook.out", "w");
  struct sigaction sa; memset(&sa, 0, sizeof sa); sa.sa_sigaction = handler; sa.sa_flags = SA_SIGINFO | SA_NODEFER;
  sigaction(SIGTRAP, &sa, 0);
  uintptr_t base = 0; dl_iterate_phdr(cb, &base);
  const char *h = getenv("HOOK_ADDRS"); // "hexvaddr:kind,..."
  if (h) { char *c = strdup(h); for (char *t = strtok(c, ","); t; t = strtok(0, ",")) { unsigned long va; int k; if (sscanf(t, "%lx:%d", &va, &k) == 2) add(base, va, k); } }
}
