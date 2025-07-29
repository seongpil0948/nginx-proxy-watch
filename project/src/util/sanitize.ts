/**
 * Sanitize server name for use in file paths, upstream names, and log directories
 * @param serverName - The server name to sanitize
 * @returns Sanitized server name safe for file system and Nginx configuration
 */
export function sanitizeServerName(serverName: string): string {
  return serverName
    .replace(/\s+/g, '-')  // Replace spaces with hyphens
    .replace(/[^a-zA-Z0-9\-_.]/g, '_')  // Replace invalid characters with underscore
    .toLowerCase();  // Convert to lowercase
}