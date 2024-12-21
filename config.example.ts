import { SSHClientConfig } from "./SSHClient.ts";

export const config = {
  login: {
    host: "",
    port: 22,
    username: "",
    password: "",
  },

  localWorkingDirectory: "",
  remoteWorkingDirectory: "",
} satisfies SSHClientConfig;
