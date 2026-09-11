/** Injectable module boundary for deterministic calendar tests; production always uses server time. */
export const trainingNow = () => new Date().toISOString();
