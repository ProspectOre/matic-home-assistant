import type {
  FloorPresentation,
  MapSafetyState,
  ReportedState,
  ViewState,
  WorkspaceResources,
  WorkspaceSelection,
  WorkspaceState,
} from "./contracts";

// A result's fields replace the state's; `resources`, `map`, `floor` and
// `selection` name only what changed and merge into the current ones.
type Reported = Partial<Omit<ReportedState, "resources" | "map" | "floor">> & {
  readonly resources?: Partial<WorkspaceResources>;
  readonly map?: Partial<MapSafetyState>;
  readonly floor?: Partial<FloorPresentation>;
};
type View = Omit<ViewState, "selection">;
// Spread members escape excess-property checks; `never` keeps them out too.
type Only<T, K extends keyof T> = Partial<Pick<T, K>> & { readonly [P in Exclude<keyof T, K>]?: never };

/**
 * What an effect tells the reducer. A `result` reports the robot and its maps,
 * and of the selection names only the robot and map it is about; a
 * `transition` also changes what the user has open.
 */
export type WorkspaceResult =
  | ({
      readonly type: "result";
      readonly selection?: Only<WorkspaceSelection, "entryId" | "floorId" | "historyId">;
    } & Reported & Only<View, never>)
  | ({ readonly type: "transition"; readonly selection?: Partial<WorkspaceSelection> } & Reported & Partial<View>);

export const applyResult = (state: WorkspaceState, result: WorkspaceResult): WorkspaceState => {
  const { type: _type, resources, map, floor, selection, ...fields } = result;
  return {
    ...state,
    ...fields,
    ...(resources && { resources: { ...state.resources, ...resources } }),
    ...(map && { map: { ...state.map, ...map } }),
    ...(floor && { floor: { ...state.floor, ...floor } }),
    ...(selection && { selection: { ...state.selection, ...selection } }),
  };
};
