/**
 * React's createRoot (and createElement), from the app's entry (main.tsx draws the app with it). A chunk that makes a root of its own (the
 * large photos' viewer) imports it from here: importing "react-dom/client" itself on demand would keep all of that
 * module in the entry, hydrateRoot included, where only createRoot is kept now.
 */
export { createElement } from "react";
export { createRoot } from "react-dom/client";
