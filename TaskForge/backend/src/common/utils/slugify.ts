/**
 * WHAT: Converts a human-entered name into a URL-safe "slug" - lowercase,
 * hyphen-separated, no special characters.
 *
 * WHY: "Acme Inc." isn't safe to put directly in a URL or use as a
 * database key alongside other unique identifiers - it has a space, a
 * period, and mixed case that would need constant normalization when
 * comparing. A slug is a stable, canonical, URL-friendly stand-in.
 *
 * WHERE: `OrganizationsService.create()`, when generating the initial slug
 * for a new organization from its display name.
 *
 * Examples: "Acme Inc." -> "acme-inc", "  Café   Central  " -> "cafe-central"
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD') // separates accented characters from their diacritics
    .replace(/[\u0300-\u036f]/g, '') // strips the diacritics, leaving plain letters
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // any run of non-alphanumeric characters -> one hyphen
    .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens
}
