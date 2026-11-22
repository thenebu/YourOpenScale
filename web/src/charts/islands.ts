/** Island registrations. One line per chart kind; WP-09 appends its own below. */
import { mountTimeSeriesIsland } from "./timeseries.ts";
import { registerIsland } from "./mount.ts";

registerIsland("timeseries", mountTimeSeriesIsland);
