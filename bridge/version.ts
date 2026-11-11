/** The bridge's version: "1.0.0" in a release build (the build script defines it), "dev" when run from source. */
export const VERSION: string = process.env.BRIDGE_BUILD_VERSION ?? "dev";

/** "darwin-arm64", "linux-x64": what the app shows next to the version. */
export const PLATFORM = `${process.platform}-${process.arch}`;
