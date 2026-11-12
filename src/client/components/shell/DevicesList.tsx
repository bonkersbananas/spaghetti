import type { SignedInDevice } from "@shared/signing-in";
import { inlineTime } from "@shared/time";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { InfoRow } from "@/components/ui/InfoRow";
import { LaptopIcon, PhoneIcon } from "@/components/ui/icons";
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
  return list.isPending ? (
    <ul>
      {[0, 1].map((i) => (
        <RowSkeleton key={i} />
      ))}
    </ul>
  ) : (
    <>
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
      <Button
        variant="danger"
        fullWidth
        disabled={others === 0}
        loading={signOutOthers.isPending}
        onClick={() => signOutOthers.mutate()}
        className="mt-3"
      >
        Sign out everywhere else
      </Button>
    </>
  );
}
