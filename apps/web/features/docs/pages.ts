// The docs page list, kept out of the client frame so server pages can read it as data.
export const DOCS = [
  { href: "/docs/train", title: "Train a model", sub: "Quickstart, in the browser" },
  { href: "/docs/node", title: "Add your laptop", sub: "Quickstart, with the CLI" },
  { href: "/docs/cli", title: "CLI reference", sub: "tod-node commands" },
  { href: "/docs/how-it-works", title: "How it works", sub: "Rounds, checks and pay" },
  { href: "/docs/learn", title: "Learn", sub: "Six lessons, hands on" },
  { href: "/docs/contracts", title: "Contracts", sub: "Live addresses" },
] as const;
