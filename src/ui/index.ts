import "dotenv/config";
import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import { OpenClaw } from "../core/manager.js";
import { ensureConfigured } from "../config/setup.js";

const config = await ensureConfigured();
const manager = new OpenClaw(config);

render(React.createElement(App, { manager }));
