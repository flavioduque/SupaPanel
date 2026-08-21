import { promises as fs } from 'fs'
import * as path from 'path'

/**
 * Traefik dynamic configuration generator for SupaPanel projects
 * Creates routing rules for each project's custom domain
 */

// Get the base path for Traefik dynamic configs
function getTraefikDynamicPath(): string {
  const mode = process.env.SUPAPANEL_MODE || 'development'
  if (mode === 'production') {
    return '/etc/supapanel/traefik/dynamic'
  }
  return path.join(process.cwd(), 'traefik', 'dynamic')
}

interface TraefikConfig {
  projectSlug: string
  domain: string        // API domain (Kong)
  studioDomain?: string // Studio domain (optional, separate from API)
  kongPort: number
  studioPort: number
}

/**
 * Generate Traefik routing configuration for a Supabase project
 * Supports separate domains for API (Kong) and Studio
 */
export async function generateProjectTraefikConfig(config: TraefikConfig): Promise<void> {
  const { projectSlug, domain, studioDomain, kongPort, studioPort } = config

  // Build routers section based on which domains are configured
  let routersConfig = ''
  let servicesConfig = ''

  // API domain configuration
  if (domain) {
    routersConfig += `
    # Main API router (Kong gateway)
    ${projectSlug}-api:
      rule: "Host(\`${domain}\`)"
      entryPoints:
        - websecure
      service: ${projectSlug}-api
      tls:
        certResolver: letsencrypt
      priority: 10
    
    # HTTP redirect for API
    ${projectSlug}-api-http:
      rule: "Host(\`${domain}\`)"
      entryPoints:
        - web
      middlewares:
        - https-redirect
      service: ${projectSlug}-api
      priority: 5`

    // No healthCheck here: Kong allowed unauthenticated /health, but newer
    // templates default to Envoy, which returns 401 on /health (and /) for
    // unauthenticated requests. A healthCheck against that path would make
    // Traefik permanently mark the backend unhealthy ("no available server")
    // even though the container is fine -- Docker's own compose healthcheck
    // already gates container health independently.
    servicesConfig += `
    ${projectSlug}-api:
      loadBalancer:
        servers:
          - url: "http://${projectSlug}-gateway:${kongPort}"`
  }

  // Studio domain configuration
  if (studioDomain) {
    routersConfig += `
    
    # Studio router
    ${projectSlug}-studio:
      rule: "Host(\`${studioDomain}\`)"
      entryPoints:
        - websecure
      service: ${projectSlug}-studio
      tls:
        certResolver: letsencrypt
      priority: 10
    
    # HTTP redirect for Studio
    ${projectSlug}-studio-http:
      rule: "Host(\`${studioDomain}\`)"
      entryPoints:
        - web
      middlewares:
        - https-redirect
      service: ${projectSlug}-studio
      priority: 5`

    servicesConfig += `
    
    ${projectSlug}-studio:
      loadBalancer:
        servers:
          - url: "http://${projectSlug}-studio:${studioPort}"`
  }

  const traefikConfig = `# Auto-generated Traefik routing for project: ${projectSlug}
# API Domain: ${domain || 'not configured'}
# Studio Domain: ${studioDomain || 'not configured'}
# Generated at: ${new Date().toISOString()}

http:
  routers:${routersConfig}

  middlewares:
    https-redirect:
      redirectScheme:
        scheme: https
        permanent: true

  services:${servicesConfig}
`

  const configPath = path.join(getTraefikDynamicPath(), `${projectSlug}.yml`)

  // Ensure directory exists
  await fs.mkdir(getTraefikDynamicPath(), { recursive: true })

  // Write the config file
  await fs.writeFile(configPath, traefikConfig)

  console.log(`Traefik config generated for project ${projectSlug} at ${configPath}`)
}

/**
 * Update an existing project's Traefik config with a new domain
 */
export async function updateProjectDomain(
  projectSlug: string,
  newDomain: string,
  kongPort: number,
  studioPort: number
): Promise<void> {
  await generateProjectTraefikConfig({
    projectSlug,
    domain: newDomain,
    kongPort,
    studioPort,
  })
}

/**
 * Remove Traefik configuration for a deleted project
 */
export async function removeProjectTraefikConfig(projectSlug: string): Promise<void> {
  const configPath = path.join(getTraefikDynamicPath(), `${projectSlug}.yml`)

  try {
    await fs.unlink(configPath)
    console.log(`Traefik config removed for project ${projectSlug}`)
  } catch (error) {
    // File may not exist if project never had a custom domain
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Failed to remove Traefik config for ${projectSlug}:`, error)
    }
  }
}

/**
 * Get the ports used by a project's services *inside the Docker network*.
 *
 * IMPORTANT: these are NOT the host-published ports (KONG_HTTP_PORT /
 * STUDIO_PORT can be anything the user configured). Traefik talks to the
 * containers over the internal `supapanel-network`, where the Supabase
 * images always listen on their fixed image-defined ports regardless of
 * what's published to the host: api-gw (kong/envoy) on 8000, studio on
 * 3000. Using the host-mapped env values here produces a Traefik target
 * that doesn't exist on the internal network (connection refused / 502).
 */
export function getProjectPorts(_envVars: Record<string, string>): { kongPort: number; studioPort: number } {
  return {
    kongPort: 8000,
    studioPort: 3000,
  }
}

/**
 * Check if a domain is properly pointed to this server (basic DNS check)
 * Returns true if the domain resolves to an IP that could be this server
 */
export async function verifyDomainDNS(domain: string): Promise<boolean> {
  try {
    // Use Node's DNS module for resolution
    const dns = await import('dns').then(m => m.promises)
    const addresses = await dns.resolve4(domain)

    // Domain resolves to at least one IP
    return addresses.length > 0
  } catch {
    // DNS resolution failed
    return false
  }
}

/**
 * Generate Traefik routing configuration for the SupaPanel itself
 */
export async function generatePanelTraefikConfig(domain: string): Promise<void> {
  const traefikConfig = `# Auto-generated Traefik routing for SupaPanel
# Domain: ${domain}
# Generated at: ${new Date().toISOString()}

http:
  routers:
    # Panel HTTPS router
    supapanel:
      rule: "Host(\`${domain}\`)"
      entryPoints:
        - websecure
      service: supapanel
      tls:
        certResolver: letsencrypt
      priority: 100
    
    # Panel HTTP redirect router
    supapanel-http:
      rule: "Host(\`${domain}\`)"
      entryPoints:
        - web
      middlewares:
        - https-redirect
      service: supapanel
      priority: 50

  middlewares:
    https-redirect:
      redirectScheme:
        scheme: https
        permanent: true

  services:
    supapanel:
      loadBalancer:
        servers:
          - url: "http://supapanel-panel:3000"
`

  const configPath = path.join(getTraefikDynamicPath(), 'panel.yml')

  // Ensure directory exists
  await fs.mkdir(getTraefikDynamicPath(), { recursive: true })

  // Write the config file
  await fs.writeFile(configPath, traefikConfig)

  console.log(`Panel Traefik config generated at ${configPath}`)
}

/**
 * Remove Traefik configuration for the panel domain
 */
export async function removePanelTraefikConfig(): Promise<void> {
  const configPath = path.join(getTraefikDynamicPath(), 'panel.yml')

  try {
    // Write empty config (just a comment)
    const emptyConfig = `# SupaPanel Panel Routing
# No custom domain configured - access via IP:3000
`
    await fs.writeFile(configPath, emptyConfig)
    console.log(`Panel Traefik config cleared at ${configPath}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to remove panel Traefik config:', error)
    }
  }
}
