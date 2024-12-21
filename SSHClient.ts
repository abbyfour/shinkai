import chalk from "chalk";
import { exec } from "node:child_process";
import {
  existsSync,
  readdirSync,
  rm,
  rmdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { RemoteItem } from "./RemoteFolder.ts";

// @ts-types="npm:@types/ssh2"
import { Client } from "ssh2";

export interface SSHClientConfig {
  login: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
  remoteWorkingDirectory: string;
  localWorkingDirectory: string;
}

export class SSHClient {
  private client: Client = new Client();

  constructor(private config: SSHClientConfig) {}

  public connect(): Promise<void> {
    console.log(`Connecting to ${chalk.cyan(this.config.login.host)}...`);

    return new Promise<void>((resolve, reject) => {
      this.client
        .on("ready", resolve)
        .on("error", reject)
        .connect({
          ...this.config.login,
        });
    });
  }

  public listFiles(options: {
    query: string;
    inFolder?: RemoteItem;
  }): Promise<RemoteItem[]> {
    return new Promise<RemoteItem[]>((resolve, reject) => {
      const command = options.inFolder
        ? `find ${options.inFolder.in(
            this.config.remoteWorkingDirectory
          )} -type f`
        : `find ${this.config.remoteWorkingDirectory} -type d | grep -i "${options.query}"`;

      this.client.exec(command, (err, stream) => {
        if (err) return reject(err);

        const items: RemoteItem[] = [];

        stream
          .on("data", (data: { toString(): string }) => {
            items.push(
              ...data
                .toString()
                .split("\n")
                .filter(Boolean)
                .map((f) => RemoteItem.fromFullPath(f))
            );
          })
          .on("close", () => resolve(items))
          .stderr.on("data", (data: { toString(): string }) =>
            reject(data.toString())
          );
      });
    });
  }

  public downloadItem(item: RemoteItem): Promise<void> {
    const remotePath = item
      .quoted()
      .pathInFolder(this.config.remoteWorkingDirectory);

    return new Promise<void>((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);

        sftp.stat(
          item.pathInFolder(this.config.remoteWorkingDirectory),
          (err, stats) => {
            if (err) {
              return reject(err);
            }

            if (stats.isDirectory()) {
              return this.compressRemoteFolder(item).then(() => {
                this.downloadItem(item.asArchive()).catch(reject).then(resolve);
              });
            }

            console.log(`Downloading ${chalk.cyan(item.path())}...`);

            const scpCommand = `sshpass -p "${this.config.login.password}" scp -P ${this.config.login.port} ${this.config.login.username}@${this.config.login.host}:${remotePath} ${this.config.localWorkingDirectory}`;

            exec(scpCommand, async (err) => {
              if (err) {
                return reject(err);
              }

              await this.deleteRemoteArchive(item);
              await this.unzipLocalArchive(item);
              resolve();
            });
          }
        );
      });
    });
  }

  public uploadItem(item: RemoteItem): Promise<void> {
    const localPath = item
      .quoted()
      .pathInFolder(this.config.localWorkingDirectory);

    return new Promise<void>((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);

        const stats = statSync(
          item.pathInFolder(this.config.localWorkingDirectory)
        );

        if (stats.isDirectory()) {
          return this.compressLocalFolder(item).then(() => {
            this.uploadItem(item.asArchive()).catch(reject).then(resolve);
          });
        }

        console.log(`Uploading ${chalk.cyan(item.path())}...`);

        const scpCommand = `sshpass -p "${this.config.login.password}" scp -P ${this.config.login.port} ${localPath} ${this.config.login.username}@${this.config.login.host}:${this.config.remoteWorkingDirectory}`;

        exec(scpCommand, async (err) => {
          if (err) {
            return reject(err);
          }

          await this.unzipRemoteArchive(item);
          resolve();
        });
      });
    });
  }

  public deleteLocalItem(item: RemoteItem): void {
    const path = item.pathInFolder(this.config.localWorkingDirectory);

    if (existsSync(item.pathInFolder(this.config.localWorkingDirectory))) {
      const stats = statSync(path);

      if (stats.isDirectory()) {
        readdirSync(path).forEach((file) => {
          this.deleteLocalItem(new LocalItem(file).in(item.filename));
        });
        rmdirSync(path);
      } else {
        unlinkSync(path);
      }
    } else {
      console.log(`Item not found: ${chalk.cyan(path)}`);
    }
  }

  private compressRemoteFolder(item: RemoteItem): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const remotePath = item.quoted().path();

      const remoteArchivePath = item
        .asArchive()
        .quoted()
        .pathInFolder(this.config.remoteWorkingDirectory);

      console.log(`Compressing ${chalk.cyan(remotePath)}`);

      const command = `cd ${this.config.remoteWorkingDirectory} && zip -r ${remoteArchivePath} ${remotePath}`;

      this.client.exec(command, (err, stream) => {
        if (err) {
          console.error(`Error executing zip command: ${err.message}`);
          return reject(err);
        }

        stream
          .on("close", (code: number) => {
            if (code !== 0) {
              return reject(new Error(`zip command failed with code ${code}`));
            }

            resolve();
          })
          .on("data", () => {})
          .stderr.on("data", () => {});
      });
    });
  }

  private compressLocalFolder(item: RemoteItem): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const localPath = item.quoted().path();

      const localArchivePath = item
        .asArchive()
        .quoted()
        .pathInFolder(this.config.localWorkingDirectory);

      console.log(`Compressing ${chalk.cyan(localPath)}`);

      const command = `cd ${this.config.localWorkingDirectory} && zip -r ${localArchivePath} ${localPath}`;

      exec(command, (err) => {
        if (err) {
          console.error(`Error executing zip command: ${err.message}`);
          return reject(err);
        }

        resolve();
      });
    });
  }

  private deleteRemoteArchive(item: RemoteItem): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const remoteArchivePath = item
        .quoted()
        .in(this.config.remoteWorkingDirectory)
        .path();

      const command = `rm ${remoteArchivePath}`;

      console.log(`Removing archive...`);

      console.log(command);

      this.client.exec(command, (err, stream) => {
        if (err) {
          console.error(`Error executing rm command: ${err.message}`);
          return reject(err);
        }

        stream
          .on("close", (code: number) => {
            if (code !== 0) {
              return reject(new Error(`rm command failed with code ${code}`));
            }

            resolve();
          })
          .on("data", () => {})
          .stderr.on("data", () => {});
      });
    });
  }

  private unzipRemoteArchive(item: RemoteItem): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const remoteArchivePath = item
        .quoted()
        .pathInFolder(this.config.remoteWorkingDirectory);

      const command = `unzip -o ${remoteArchivePath} -d ${this.config.remoteWorkingDirectory}`;

      console.log(`Unzipping archive...`);

      this.client.exec(command, (err, stream) => {
        if (err) {
          console.error(`Error executing unzip command: ${err.message}`);
          return reject(err);
        }

        stream
          .on("close", (code: number) => {
            if (code !== 0) {
              return reject(
                new Error(`unzip command failed with code ${code}`)
              );
            }

            this.client.exec(`rm ${remoteArchivePath}`, (err) => {
              if (err) {
                console.error(`Error removing remote archive: ${err.message}`);
                return reject(err);
              }

              resolve();
            });
          })
          .on("data", () => {})
          .stderr.on("data", () => {});
      });
    });
  }

  private unzipLocalArchive(item: RemoteItem): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const localArchivePath = item
        .quoted()
        .pathInFolder(this.config.localWorkingDirectory);

      const command = `unzip -o ${localArchivePath} -d ${this.config.localWorkingDirectory}`;

      console.log(`Unzipping archive...`);

      exec(command, (err) => {
        if (err) {
          console.error(`Error executing unzip command: ${err.message}`);
          return reject(err);
        }

        rm(item.pathInFolder(this.config.localWorkingDirectory), (err) => {
          if (err) {
            console.error(`Error removing local archive: ${err.message}`);
            return reject(err);
          }

          resolve();
        });
      });
    });
  }
}
