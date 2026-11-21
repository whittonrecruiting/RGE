export const THEME_COOKIE = "rge-theme";

export type Theme = "dark" | "light";

export function parseTheme(value: string | undefined): Theme {
  return value === "light" ? "light" : "dark";
}
