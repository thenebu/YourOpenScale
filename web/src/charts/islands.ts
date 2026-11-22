/** Island registrations. One line per chart kind; WP-09 appends its own below. */
import { mountTimeSeriesIsland } from "./timeseries.ts";
import { registerIsland } from "./mount.ts";

registerIsland("timeseries", mountTimeSeriesIsland);

// WP-09 chart kinds.
import { mountCountBarsIsland, mountDivergingBarsIsland, mountEffectBarsIsland } from "./bars.ts";
import { mountCompositionBarsIsland, mountCompositionIsland } from "./composition.ts";
import { mountCalendarIsland } from "./heatmap.ts";
import { mountHistogramIsland } from "./histogram.ts";
import { mountYearsIsland } from "./years.ts";

registerIsland("diverging-bars", mountDivergingBarsIsland);
registerIsland("effect-bars", mountEffectBarsIsland);
registerIsland("count-bars", mountCountBarsIsland);
registerIsland("histogram", mountHistogramIsland);
registerIsland("calendar", mountCalendarIsland);
registerIsland("composition", mountCompositionIsland);
registerIsland("composition-bars", mountCompositionBarsIsland);
registerIsland("years", mountYearsIsland);
