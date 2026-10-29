/** Examples use Studio's document transport only on the hosted CAD route. */
export function isStudioExampleHosted(): boolean {
  return location.pathname.startsWith("/cad/");
}
