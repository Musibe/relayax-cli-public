/**
 * Map anpm.yaml requires to cloud environment packages.
 *
 * anpm.yaml requires:            → Anthropic environment packages:
 *   npm: [eslint, typescript]    →   npm: ["eslint", "typescript"]
 *   pip: [pandas]                →   pip: ["pandas"]
 *   cli: [{name: git}]           →   apt: ["git"]
 */
export function mapRequiresToPackages(requires: Record<string, unknown>): Record<string, string[]> {
  const packages: Record<string, string[]> = {}

  if (Array.isArray(requires.npm)) {
    packages.npm = requires.npm.map(String)
  }

  if (Array.isArray(requires.pip)) {
    packages.pip = requires.pip.map(String)
  }

  // cli items → apt packages
  if (Array.isArray(requires.cli)) {
    packages.apt = requires.cli
      .map((item: unknown) => {
        if (typeof item === 'string') return item
        if (typeof item === 'object' && item !== null && 'name' in item) {
          return (item as { name: string }).name
        }
        return null
      })
      .filter((v): v is string => v !== null)
  }

  return packages
}
