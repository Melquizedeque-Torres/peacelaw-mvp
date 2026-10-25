import type { FieldError } from "@/lib/api";

export function FieldErrors({ errors }: { errors: FieldError[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-danger-700">
      {errors.map((e, i) => (
        <li key={`${e.field}-${i}`}>{e.message}</li>
      ))}
    </ul>
  );
}
