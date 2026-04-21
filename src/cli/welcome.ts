import chalk from "chalk";

const PANDA = `
  ${chalk.white("⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛")}
  ${chalk.white("⬛")}${chalk.bgBlack.black("          ")}${chalk.white("⬛")}${chalk.bgBlack.black("          ")}${chalk.white("⬛")}
  ${chalk.white("⬛⬛⬛⬛")}${chalk.bgWhite("                    ")}${chalk.white("⬛⬛⬛⬛")}
        ${chalk.bgWhite("  ")}${chalk.bgBlack("  ")}${chalk.bgWhite("    ")}${chalk.bgBlack("  ")}${chalk.bgWhite("  ")}
        ${chalk.bgWhite("  ")}${chalk.bgBlack(" ◉")}${chalk.bgWhite("    ")}${chalk.bgBlack("◉ ")}${chalk.bgWhite("  ")}
        ${chalk.bgWhite("                ")}
        ${chalk.bgWhite("    ")}${chalk.bgBlack("  ")}${chalk.bgWhite("    ")}${chalk.bgBlack("  ")}${chalk.bgWhite("    ")}
        ${chalk.bgWhite("  ")}${chalk.bgBlack("      ")}${chalk.bgWhite("        ")}
        ${chalk.bgWhite("                ")}
`;

const PANDA_ASCII = `
  ${chalk.bold.white("   (\\(\\  ")}
  ${chalk.bold.white("  ( -.-)  ")}  ${chalk.bold.cyan("OpenPanda")} ${chalk.dim("v0.1.0")}
  ${chalk.bold.white(" o_(\")(\")  ")}  ${chalk.dim("Lightweight agent manager")}
               ${chalk.dim("powered by")} ${chalk.bold.magenta("Entropy AI Lab.")}
`;

export function printWelcome() {
  console.log(PANDA_ASCII);
  console.log(
    chalk.dim("  Commands: ") +
      chalk.cyan("spawn") +
      chalk.dim("  ·  ") +
      chalk.cyan("list") +
      chalk.dim("  ·  ") +
      chalk.cyan("stop") +
      chalk.dim("  ·  ") +
      chalk.cyan("chat") +
      chalk.dim("  ·  ") +
      chalk.cyan("ui")
  );
  console.log();
}
