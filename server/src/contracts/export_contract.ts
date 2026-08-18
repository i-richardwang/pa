const EXPORT_RESOURCE_URI_PREFIX = "pa://export/";

export const EXPORT_RESOURCE_URI_TEMPLATE = `${EXPORT_RESOURCE_URI_PREFIX}{ticket}`;
export const EXPORT_RESOURCE_MIME_TYPE = "text/csv; charset=utf-8";

export const exportResourceUri = (ticket: string) => `${EXPORT_RESOURCE_URI_PREFIX}${ticket}`;
