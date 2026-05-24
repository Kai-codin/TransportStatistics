type JsonEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
};

export function JsonEditor({ value, onChange, readOnly }: JsonEditorProps) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      readOnly={readOnly}
      className="min-h-[140px] w-full rounded-2xl border border-ts-border bg-ts-surface-2 px-3 py-3 text-sm text-ts-text-1 outline-none transition focus:border-ts-accent focus:ring-2 focus:ring-ts-accent/20"
    />
  );
}
