# @tod/abi

The compiled `IJobMarket` and `INodeRegistry` interfaces and `ToDToken` contract produce JSON ABIs for Python and typed `as const` arrays for TypeScript consumers. The package exports `iJobMarketAbi`, `iNodeRegistryAbi`, `toDTokenAbi` and `./json/*`.

Run `npm run generate --prefix packages/abi` from the repository root. This builds the interfaces and writes `json/IJobMarket.json`, `json/INodeRegistry.json` `json/ToDToken.json` and `src/generated.ts`. These outputs are ignored by Git and must be generated during setup and image builds.

Run `npm run check --prefix packages/abi` to compare existing outputs with the compiled interfaces. Missing or changed output fails the check; it does not rewrite the files. Regenerate after changing an interface, then check the result before building consumers.
