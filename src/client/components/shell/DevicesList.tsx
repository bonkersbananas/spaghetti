import type { SignedInDevice } from "@shared/signing-in";
import { inlineTime } from "@shared/time";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { InfoRow } from "@/components/ui/InfoRow";
import { LaptopIcon, PhoneIcon } from "@/components/ui/icons";
import { Overline } from "@/components/ui/Overline";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { devicesQuery } from "@/lib/passkey-lists";

export const isPhoneLike = (name: string) => /iPhone|iPad|Android/.test(name);

/** Where you are signed in: each device and when it was last seen, "Sign out" for one, and "Sign out everywhere else". */
export function DevicesList({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const list = useQuery({ ...devicesQuery, enabled });
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
    <section aria-labelledby="devices-heading" className="flex flex-col gap-1">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <Overline as="h3" id="devices-heading">
          Signed-in devices
        </Overline>
        {others > 0 && (
          <Button variant="danger" size="sm" loading={signOutOthers.isPending} onClick={() => signOutOthers.mutate()}>
            Sign out everywhere else
          </Button>
        )}
      </div>
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
              icon={isPhoneLike(device.device) ? PhoneIcon : LaptopIcon}
              title={device.device}
              meta={device.current ? "This device" : `Last seen ${inlineTime(device.lastSeenAt)}`}
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
    </section>
  );
}
