import { EMPTY, ObservableInput, SchedulerLike } from "rxjs";
import { expand } from "rxjs/operators";

// custom operator that only expand if the value is distinct from previous values
export const distinctExpand = <T>(
  fn: (value: T) => ObservableInput<T>,
  concurrent?: number,
  scheduler?: SchedulerLike,
) => {
  const set = new Set<T>();
  return expand(
    (value: T) => {
      if (set.has(value)) {
        return EMPTY;
      }
      set.add(value);
      return fn(value);
    },
    concurrent,
    scheduler,
  );
};
