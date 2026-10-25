import { cn } from "@/lib/utils";

type Props = {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
};

// Native range input: keyboard, touch and screen-reader support come for free.
// appearance-none plus explicit pseudo-element styling makes the large size apply in all engines.
export function ScoreSlider({ id, label, value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-xl font-semibold text-slate-900">
          {label}
        </label>
        <span aria-hidden="true" className="text-3xl font-bold tabular-nums text-slate-900">
          {value}
          <span className="text-lg font-medium"> de 10</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={10}
        step={1}
        value={value}
        aria-valuetext={`${value} de 10`}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn(
          "h-11 w-full cursor-pointer appearance-none bg-transparent",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-700 focus-visible:ring-offset-[3px]",
          "[&::-webkit-slider-runnable-track]:h-3 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-slate-600",
          "[&::-webkit-slider-thumb]:-mt-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-8 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-primary-700",
          "[&::-moz-range-track]:h-3 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-slate-600",
          "[&::-moz-range-thumb]:size-8 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-primary-700",
        )}
      />
      <div className="flex justify-between text-base font-medium text-slate-700" aria-hidden="true">
        <span>0</span>
        <span>10</span>
      </div>
    </div>
  );
}
