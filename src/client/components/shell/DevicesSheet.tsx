import type { SignedInDevice } from "@shared/signing-in";
import { relativeTime } from "@shared/time";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { InfoRow } from "@/components/ui/InfoRow";
import { LaptopIcon, PhoneIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { devicesQuery } from "@/lib/passkey-lists";

const isPhone = (device: string) => /iPhone|iPad|Android/.test(device);

/** Where you are signed in: each device and when it was last seen, "Sign out" for one, and "Sign out everywhere else". */
export function DevicesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const list = useQuery({ ...devicesQuery, enabled: open });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: devicesQuery.queryKey });

  const signOut = useMutation({
    mutationFn: (device: SignedInDevice) => api(`/account/devices/${device.id}`, { method: "DELETE" }),
    onMutate: (device) => {
      queryClient.setQueryData<SignedInDevice[]>(devicesQuery.queryKey, (all) =>
        all?.filter((d) => d.id !== device.id),
      );
    },
    onSettled: refresh,
  });
  const signOutOthers = useMutation({
    mutationFn: () => api<{ signedOut: number }>("/account/devices/sign-out-others", { method: "POST" }),
    onSuccess: ({ signedOut }) =>
      toast.success(signedOut === 1 ? "Signed out on 1 other device" : `Signed out on ${signedOut} other devices`),
    onSettled: refresh,
  });

  const devices = list.data ?? [];
  const others = devices.filter((d) => !d.current).length;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Signed-in devices"
      description="Where you're signed in right now."
      footer={
        <Button
          variant="secondary"
          fullWidth
          disabled={others === 0}
          loading={signOutOthers.isPending}
          onClick={() => signOutOthers.mutate()}
        >
          Sign out everywhere else
        </Button>
      }
    >
      {list.isPending ? (
        <ul>
          {[0, 1].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </ul>
      ) : (
        <ul>
          {devices.map((device) => (
            <InfoRow
              key={device.id}
              icon={isPhone(device.device) ? PhoneIcon : LaptopIcon}
              title={device.device}
              meta={device.current ? "This device" : `Last seen ${relativeTime(device.lastSeenAt).toLowerCase()}`}
              actions={
                !device.current && (
                  <Button variant="quiet" size="sm" onClick={() => signOut.mutate(device)}>
                    Sign out
                  </Button>
                )
              }
            />
          ))}
        </ul>
      )}
    </Sheet>
  );
}
