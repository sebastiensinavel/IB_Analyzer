import { useEffect, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { Input } from "@ib/ui/input";

interface EditableCellProps extends Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onBlur" | "onKeyDown"> {
  /** The stored value, as text. */
  value: string;
  /** Writes the typed text; `false` when it cannot be written (an unreadable score, a row gone). */
  onCommit: (text: string) => Promise<boolean>;
  /**
   * What the draft would be stored as, e.g. trimmed or reparsed. Defaults to identity. When it
   * equals `value`, the draft is a no-op spelling of what is already stored: it is reset to
   * `value` and never written.
   */
  normalize?: (text: string) => string;
}

/**
 * One field of a stored row. It is written when it loses focus or on Enter, only if the text
 * changed; Escape puts the stored value back. While the user has not touched it, it follows the
 * stored value — a CSV import rewriting the row updates it — but never under their typing.
 */
export function EditableCell({ value, onCommit, normalize = (text) => text, ...inputProps }: EditableCellProps) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  // A ref, not state: the effect below must read it without re-running when it flips.
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);

  async function commit() {
    if (!dirty.current) return;
    if (draft === value || normalize(draft) === value) {
      dirty.current = false;
      setInvalid(false);
      setDraft(value);
      return;
    }
    const accepted = await onCommit(draft);
    setInvalid(!accepted);
    if (accepted) dirty.current = false;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      dirty.current = false;
      setDraft(value);
      setInvalid(false);
    }
  }

  return (
    <Input
      {...inputProps}
      value={draft}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        dirty.current = true;
        setDraft(event.target.value);
      }}
      onBlur={() => void commit()}
      onKeyDown={handleKeyDown}
    />
  );
}
