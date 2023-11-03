const fs = require("node:fs/promises");
const { join } = require("node:path");
const PackageJson = require("@npmcli/package-json");
const { Command } = require("commander");
const inquirer = require("inquirer");

const foldersToExclude = [".github"];

// Netlify Edge Functions template file changes
const edgeFilesToCopy = [
  ["README-edge.md", "README.md"],
  ["netlify-edge.toml", "netlify.toml"],
  ["server.ts"],
  ["remix.config.js"],
  ["vscode.json", ".vscode/settings.json"],
];

// Netlify Functions template file changes
const filesToCopy = [["README.md"], ["netlify.toml"], [".redirects"]];

async function copyTemplateFiles({ files, rootDirectory }) {
  for (const [file, target] of files) {
    let sourceFile = file;
    let targetFile = target || file;

    await fs.copyFile(
      join(rootDirectory, "remix.init", sourceFile),
      join(rootDirectory, targetFile)
    );
  }
}

const removeUnusedDependencies = (dependencies, unusedDependencies) =>
  Object.fromEntries(
    Object.entries(dependencies).filter(
      ([key]) => !unusedDependencies.includes(key)
    )
  );

async function updatePackageJsonForEdge(directory) {
  const packageJson = await PackageJson.load(directory);
  const { dependencies, scripts, ...restOfPackageJson } = packageJson.content;

  packageJson.update({
    ...restOfPackageJson,
    dependencies: removeUnusedDependencies(dependencies, [
      "@netlify/functions",
      "@netlify/remix-adapter",
      "shx",
      "source-map-support",
    ]),
    // dev script is the same as the start script for Netlify Edge, "cross-env NODE_ENV=production netlify dev"
    scripts: {
      ...scripts,
      dev: 'remix dev --manual -c "ntl dev --framework=#static"',
    },
  });

  await packageJson.save();
}

async function updatePackageJsonForFunctions(directory) {
  const packageJson = await PackageJson.load(directory);
  const { dependencies, scripts, ...restOfPackageJson } = packageJson.content;

  packageJson.update({
    ...restOfPackageJson,
    dependencies: removeUnusedDependencies(dependencies, [
      "@netlify/edge-functions",
      "@netlify/remix-edge-adapter",
      "@netlify/remix-runtime",
    ]),
    scripts: {
      ...scripts,
      build: "npm run redirects:enable && remix build",
      dev: "npm run redirects:disable && remix dev",
      "redirects:enable": "shx cp .redirects public/_redirects",
      "redirects:disable": "shx rm -f public/_redirects",
    },
  });

  await packageJson.save();
}

async function removeNonTemplateFiles({ rootDirectory, folders }) {
  try {
    await Promise.allSettled(
      folders.map((folder) =>
        fs.rm(join(rootDirectory, folder), { recursive: true, force: true })
      )
    );
  } catch (e) {
    console.log(
      `Unable to remove folders ${folders.join(
        ", "
      )}. You can remove them manually.`
    );
  }
}

async function main({ rootDirectory, packageManager }) {
  await removeNonTemplateFiles({
    rootDirectory,
    folders: foldersToExclude,
  });

  if (!(await shouldUseEdge())) {
    await copyTemplateFiles({
      files: filesToCopy,
      rootDirectory,
    });
    await updatePackageJsonForFunctions(rootDirectory);
    return;
  }

  await Promise.all([
    fs.mkdir(join(rootDirectory, ".vscode")),
    copyTemplateFiles({ files: edgeFilesToCopy, rootDirectory }),
  ]);

  await updatePackageJsonForEdge(rootDirectory);
}

async function shouldUseEdge() {
  // parse the top level command args to see if edge was passed in
  const program = new Command();
  program
    .option(
      "--netlify-edge",
      "explicitly use Netlify Edge Functions to serve this Remix site.",
      undefined
    )
    .option(
      "--no-netlify-edge",
      "explicitly do NOT use Netlify Edge Functions to serve this Remix site - use Serverless Functions instead.",
      undefined
    );
  program.allowUnknownOption().parse();

  const passedEdgeOption = program.opts().netlifyEdge;

  if (passedEdgeOption !== true && passedEdgeOption !== false) {
    const { edge } = await inquirer.prompt([
      {
        name: "edge",
        type: "list",
        message: "Run your Remix site with:",
        choices: [
          {
            name: "Netlify Functions",
            value: false,
          },
          {
            name: "Netlify Edge Functions",
            value: true,
          },
        ],
      },
    ]);
    return edge;
  }

  return passedEdgeOption;
}

module.exports = main;
