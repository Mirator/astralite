// The nearest few of a list, without sorting the whole of it or allocating a copy every frame.

/**
 * The first `count` items of `items` ordered by `distance`, nearest first - exactly the prefix a stable
 * sort of a copy would give, ties kept in list order - written into `into`, which is returned. The frame
 * loop asked for four lamps out of dozens by copying and sorting every one of them sixty times a second.
 */
export const nearestFirst = <T>(items: readonly T[], count: number, distance: (item: T) => number, into: T[]): T[] => {
  into.length = 0;
  const far: number[] = [];
  for (const item of items) {
    const d = distance(item);
    if (into.length === count && d >= far[count - 1]) continue;
    // After every entry at the same distance, so equal distances keep the order the list gave them.
    let at = into.length;
    while (at > 0 && far[at - 1] > d) at--;
    into.splice(at, 0, item); far.splice(at, 0, d);
    if (into.length > count) { into.pop(); far.pop(); }
  }
  return into;
};
