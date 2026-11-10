/**
 * The pieces of sharing into Spaghetti from places that aren't the installed app: the iOS Shortcut's values and
 * steps (shown on the Agents page with the token filled in, and written out in docs/share.md) and the bookmarklet.
 */

/** The address a Shortcut posts to. */
export const captureAddress = (origin: string) => `${origin}/api/capture`;

/** The Authorization header's value. */
export const bearerHeader = (token: string) => `Bearer ${token}`;

/**
 * "Save to Spaghetti": a bookmarklet that opens the share route in a small window with the page's title, its
 * address and what is selected. It needs no token: the window is the app, signed in as you.
 */
export function bookmarklet(origin: string): string {
  const code = `(()=>{var s=String(getSelection()),q='?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href)+(s?'&text='+encodeURIComponent(s.slice(0,2000)):'');window.open(${JSON.stringify(origin)}+'/share'+q,'spaghetti','popup,width=480,height=680')||(location.href=${JSON.stringify(origin)}+'/share'+q)})()`;
  return `javascript:${code}`;
}

export interface ShortcutStep {
  /** The step in a sentence. */
  text: string;
  /** A value to type or paste there, with the label the Shortcuts app shows for it. */
  value?: { label: string; value: string };
}

export interface ShortcutRecipe {
  name: string;
  /** What it takes from the share sheet. */
  accepts: string;
  steps: ShortcutStep[];
}

/** The two Shortcuts to build, with this app's address and the token in the steps that need them. */
export function shortcutRecipes(origin: string, token: string): ShortcutRecipe[] {
  const post: ShortcutStep[] = [
    {
      text: "Add the action Get Contents of URL and paste the address as its URL.",
      value: { label: "Address", value: captureAddress(origin) },
    },
    { text: "Tap Show More. Set Method to POST." },
    {
      text: "Add a header named Authorization with this value.",
      value: { label: "Authorization", value: bearerHeader(token) },
    },
  ];
  return [
    {
      name: "Share to Spaghetti",
      accepts: "links and text",
      steps: [
        { text: "In the Shortcuts app tap +, and name the shortcut Share to Spaghetti." },
        { text: "Tap (i), turn on Show in Share Sheet, and under Share Sheet Types keep only URLs and Text." },
        ...post,
        { text: "Set Request Body to Form. Add a Text field named text, and set its value to Shortcut Input." },
        {
          text: "Last, add Show Notification and set its text to Contents of URL. It says Saved to Spaghetti, or what went wrong, so a failure is never silent.",
        },
      ],
    },
    {
      name: "Share photo to Spaghetti",
      accepts: "photos",
      steps: [
        { text: "Make a second shortcut, named Share photo to Spaghetti. Under Share Sheet Types keep only Images." },
        {
          text: "Add the action Convert Image, set to JPEG, with Shortcut Input as its image. iPhone photos are HEIC, which Spaghetti doesn't store.",
        },
        ...post,
        { text: "Set Request Body to File, and choose the Converted Image." },
        {
          text: "Last, add Show Notification and set its text to Contents of URL. It says Saved to Spaghetti, or what went wrong, so a failure is never silent.",
        },
      ],
    },
  ];
}

/** Every step as plain text, to copy in one go. */
export function recipesAsText(recipes: ShortcutRecipe[]): string {
  return recipes
    .map(
      (recipe) =>
        `${recipe.name} (${recipe.accepts})\n${recipe.steps
          .map(
            (step, index) =>
              `${index + 1}. ${step.text}${step.value ? `\n   ${step.value.label}: ${step.value.value}` : ""}`,
          )
          .join("\n")}`,
    )
    .join("\n\n");
}
