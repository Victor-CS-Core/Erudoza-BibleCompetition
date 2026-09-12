/** Separate managed-local entrypoint. This file is never the production Worker main. */
import { installMaintenanceHandler } from './protocol';
import { handleMaintenance } from './adapter';
installMaintenanceHandler(handleMaintenance);
export { PracticeRoom } from '../practice/room';
export { PracticeReports } from '../practice/reports';
export { PbeSoloRound } from '../pbe/solo-round';
export { PasswordCrypto } from '../password-crypto';
export default { fetch(): Response { return new Response(null, { status: 404 }); } };
