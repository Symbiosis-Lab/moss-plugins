/**
 * Gatsby Default Templates
 *
 * Creates basic Gatsby layouts and components.
 */

import { writeFile } from "@symbiosis-lab/moss-api";

/**
 * Creates default Gatsby layouts and components.
 */
export async function createDefaultLayouts(
  runtimeDir: string,
  projectPath: string
): Promise<void> {
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);

  // Base Layout Component
  await writeFile(
    `${runtimeRelative}/src/components/Layout.js`,
    `import * as React from "react"

const Layout = ({ title, children }) => {
  return (
    <>
      <style>
        {\`
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            color: #333;
          }
          a { color: #0066cc; }
          h1, h2, h3 { margin-top: 2rem; }
          code {
            background: #f4f4f4;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
          }
          pre code {
            display: block;
            padding: 1rem;
            overflow-x: auto;
          }
        \`}
      </style>
      <header>
        <nav>
          <a href="/">Home</a>
        </nav>
      </header>
      <main>
        {children}
      </main>
      <footer>
        <p>&copy; {new Date().getFullYear()}</p>
      </footer>
    </>
  )
}

export default Layout
`
  );

  // Package.json for the Gatsby project
  await writeFile(
    `${runtimeRelative}/package.json`,
    `{
  "name": "gatsby-site",
  "version": "0.0.1",
  "scripts": {
    "build": "gatsby build"
  },
  "dependencies": {
    "gatsby": "^5.0.0",
    "gatsby-source-filesystem": "^5.0.0",
    "gatsby-transformer-remark": "^6.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
`
  );

  // Create empty src/content directory marker
  await writeFile(
    `${runtimeRelative}/src/content/.gitkeep`,
    ``
  );
}

function getRelativePath(basePath: string, targetPath: string): string {
  if (targetPath.startsWith(basePath)) {
    return targetPath.substring(basePath.length).replace(/^\//, "");
  }
  if (!targetPath.startsWith("/")) {
    return targetPath;
  }
  return targetPath;
}
