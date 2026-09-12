/** The product bundle contains only this closed dispatch seam, never the restore engine. */
export const MAINTENANCE_PREFIX = '/__maintenance/v1/';
export interface MaintenanceIdentity {
    bundleId: string;
    targetId: string;
    buildId: string;
    schemaId: string;
    mappingId: string;
    ticket: string;
}
export type MaintenanceScope = {
    kind: 'room';
    orgId: string;
    seasonId: string;
    id: string;
} | {
    kind: 'reports';
    orgId: string;
    seasonId: string;
};
export interface MaintenanceEnvironment {
    NATIVE_MAINTENANCE_MODE?: unknown;
    NATIVE_MAINTENANCE_IDENTITY?: unknown;
}
export const maintenanceOffline = (env: unknown): boolean => (env as MaintenanceEnvironment).NATIVE_MAINTENANCE_MODE === 'offline-v1';
type Handler = (request: Request, storage: DurableObjectStorage, env: unknown, kind: MaintenanceScope['kind'], objectId: string) => Promise<Response>;
let handler: Handler | undefined;
/** Installed exclusively by the separate closed entrypoint. */
export function installMaintenanceHandler(value: Handler) {
    if (handler && handler !== value)
        throw new Error('Maintenance handler already installed.');
    handler = value;
}
export function dispatchMaintenance(request: Request, storage: DurableObjectStorage, env: unknown, kind: MaintenanceScope['kind'], objectId: string): Promise<Response> {
    if (!maintenanceOffline(env) || !handler)
        return Promise.resolve(new Response(null, { status: 404 }));
    return handler(request, storage, env, kind, objectId);
}
