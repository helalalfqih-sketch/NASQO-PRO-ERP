import { createContext } from "react";

// Scoped to the currently authenticated workspace; never a module-global user ID.
export const UiResumeWorkspaceContext = createContext("");
export const UiResumeScreenContext = createContext("");
