import { toast } from "@/components/ui/Toast";
import { looksLikeModel } from "./model-pick";

/** Hands each model among `files` to `take`, and says gently, once, if some weren't models. */
export async function takeModels(files: Iterable<File>, take: (file: File) => void, only?: "stl") {
  let refused = 0;
  for (const file of files) {
    if (await looksLikeModel(file, only)) take(file);
    else refused++;
  }
  if (refused) {
    toast.message("That isn't a model file", only ? "Spaghetti takes .stl here." : "Spaghetti takes .stl and .3mf.");
  }
}
