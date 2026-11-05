export type ShortcutKeyEvent = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function shortcutFromEvent(event: ShortcutKeyEvent) {
  if (event.key === "Escape") return "escape";
  if (event.key === "Backspace" || event.key === "Delete") return "";
  if (["Meta", "OS", "Control", "Alt", "Shift"].includes(event.key)) return null;
  const modifiers: string[] = [];
  // Keep physical modifiers distinct. CommandOrControl is only for defaults.
  if (event.ctrlKey) modifiers.push("Control");
  if (event.metaKey) modifiers.push("Super");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!modifiers.length) return null;
  const aliases: Record<string, string> = { Space: "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Enter: "Enter", Tab: "Tab", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown" };
  const key = event.code.startsWith("Key") ? event.code.slice(3)
    : event.code.startsWith("Digit") ? event.code.slice(5)
      : /^F(?:[1-9]|1\d|2[0-4])$/.test(event.code) ? event.code
        : aliases[event.code] || (event.key.length === 1 && /[a-z0-9]/i.test(event.key) ? event.key.toUpperCase() : "");
  return key ? [...modifiers, key].join("+") : null;
}

export function shortcutLabel(value: string, platform: string) {
  if (!value) return "—";
  const mac = platform === "darwin";
  return value.split("+").map((part) => {
    if (["CommandOrControl", "CmdOrCtrl"].includes(part)) return mac ? "⌘" : "Ctrl";
    if (["Super", "Command", "Meta"].includes(part)) return mac ? "⌘" : platform === "win32" ? "Win" : "Super";
    if (["Control", "Ctrl"].includes(part)) return mac ? "⌃" : "Ctrl";
    if (part === "Alt") return mac ? "⌥" : "Alt";
    if (part === "Shift") return mac ? "⇧" : "Shift";
    return part;
  }).join(mac ? " " : " + ");
}
