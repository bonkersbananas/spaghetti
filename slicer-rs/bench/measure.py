"""Runs a command and prints, as JSON, its wall time and the peak memory (max resident set) of the biggest process
it ran: python3 -I measure.py <command…>. One measurement per call, so the peak is that run's alone."""

import json
import resource
import subprocess
import sys
import time

start = time.perf_counter()
done = subprocess.run(sys.argv[1:], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
wall = time.perf_counter() - start
usage = resource.getrusage(resource.RUSAGE_CHILDREN)
print(
    json.dumps(
        {
            "code": done.returncode,
            "wall_ms": round(wall * 1000, 1),
            "peak_mb": round(usage.ru_maxrss / 1024, 1),
            "cpu_s": round(usage.ru_utime + usage.ru_stime, 2),
            "stdout": done.stdout.decode("utf-8", "replace")[-4000:],
            "stderr": done.stderr.decode("utf-8", "replace")[-2000:],
        }
    )
)
