import { MoonIcon, SunIcon, SystemThemeIcon } from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { type ThemePreference, useTheme } from "@/lib/theme";

const options = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: SystemThemeIcon },
] as const satisfies { value: ThemePreference; label: string; icon: typeof SunIcon }[];

/** Light, dark or follow the system. Remembered on this device. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <SegmentedControl
      label="Appearance"
      options={[...options]}
      value={preference}
      onChange={setPreference}
      className={className}
    />
  );
}
