const {spawn} = require('child_process');
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});
const fs = require("fs");
const jsmediatags = require("jsmediatags");
const path = require("path");
const resizer = require("sharp");

const startTime = new Date().getTime();

let version = -1;
let amountExported = 0;

let guysdone = 0;
let guysFailed = 0;
let fetchedAlbums = 0;
let expectedAlbums = 0;
let completed = [];
let albumsAskedFor = [];
let user = "";

Main();

function findCoverFromApple(albumName = "Origins", artistName = "") {
    return new Promise((resolve, reject) => {
        let out = '';
        let http = `https://itunes.apple.com/search?term=${encodeURI(albumName)}&media=music&country=us&entity=album`;
        console.log("Querying " + http);
        let req = spawn("curl", [http]);

        req.stdout.on('data', (data) => {
            out += data.toString();
        });

        req.on('exit', () => {
            console.log("query finnished");
            let json;
            try {
                json = JSON.parse(out);
            } catch (e) {
            }
            let album = json.results.filter((listing) => (listing.artistName + "").toLowerCase().includes(artistName.toLowerCase()));
            if (album.length === 0)
                reject("Nope");
            else
                resolve(album[0].artworkUrl100.replace("100x100", "512x512"));
        });
    });

}

function Main() {
    if (!fs.existsSync(path.join(process.cwd(), "images")))
        fs.mkdirSync(path.join(process.cwd(), "images"));
    fs.writeFileSync(path.join(process.cwd(), "all.dat"), "");
    readline.question("Who is this (github username is good, just for naming your files for the library)\n", (nameIn) => {
        user = nameIn;
        readline.question("MP3 or DAT: ", (choice) => {
            readLast();
            if (!fs.existsSync("groove0")) {
                createExportFolder("spotify");
                createExportFolder("groove");
                createExportFolder("musicbee");
            }
            if (choice.toLowerCase() === "dat") {
                fs.readdirSync(process.cwd()).forEach(filder => {
                    if (filder.includes('.dat') && !filder.includes("all.dat")) {
                        downloadAlbumsFromFile(filder).then(() => {
                            console.log("\nFinished downloading.");
                            //setupExport();
                            process.exit(0);
                        }).catch((e) => {
                            console.error(e);
                            //setupExport();
                            process.exit(1);
                        });
                    }
                });
            } else if (choice.toLowerCase() === "mp3") {
                readline.question('Where are your pictures? (fully qualified dir pls)\n', loc => {
                    if (fs.lstatSync(loc).isDirectory())
                        locateMP3FromFolder(loc).then((resolver) => {
                            console.log(`All done from ${resolver} ${guysdone} (${guysFailed})`);
                            //setupExport();
                            process.exit(0);
                        }).catch(console.error);
                    else
                        console.log("I can't find this.");
                });
            } else {
                console.log("Can you choose, like, a real option? Thanks.");
                Main();
            }
        });
    });
}

function downloadAlbumsFromFile(file) {
    return new Promise((resolve, reject) => {
        let resolves = 0;
        let data = fs.readFileSync(file).toString().split("\n");
        data.forEach((line) => {
            const allTheExtraStuff = line.replace('\r', '').split('==');
            const album = allTheExtraStuff.shift();
            const link = allTheExtraStuff.shift().replace('\r', '');
            if (!completed.includes(album + allTheExtraStuff.join('')))
            downloadImageFromWeb(cleanUp(album), cleanUp(allTheExtraStuff.join('')), link).then((res) => {
                writeOverwritable(`Downloaded album cover (${resolves}) : ` + album);
                fs.appendFileSync(path.join(process.cwd(), "all.dat"), album + (allTheExtraStuff.length > 0 ? "==" + allTheExtraStuff.join('==') : "") + "\r\n");
                appendSingleton(album, allTheExtraStuff);
                if (++resolves === data.length)
                    resolve();
            }).catch((thing) => {
                if (++resolves === data.length)
                    resolve();
            });
            else if (++resolves === data.length)
                resolve();
        });
    });
}

function downloadImageFromWeb(albumName, artist, url) {
    return new Promise((resolve, reject) => {
        writeOverwritable(`I'm downloading ` + url);
        let p = spawn("curl", [url]);
        let out = fs.createWriteStream(path.join(process.cwd(), "images/" + cleanUp(albumName) + cleanUp(artist) + ".jpg"));
        p.stdout.pipe(out);
        p.on("exit", (code) => {
            if (code === 0)
                resolve();
            else
                reject(code);
        });
    });
}

function locateMP3FromFolder(folder) {
    return new Promise((resolve, reject) => {
        for (const file of fs.readdirSync(folder)) {
            if (fs.lstatSync(folder + '\\' + file).isDirectory())
                locateMP3FromFolder(folder + '\\' + file).then(() => {
                    if (fetchedAlbums === expectedAlbums)
                        resolve();
                }).catch(reject);
            else if ((folder + '\\' + file).includes(".mp3")) {
                expectedAlbums++;
                fetchAlbumsFromMP3(folder, file).then(thing => {
                    if (completed.includes(thing.tags.album + thing.tags.artist)) {
                        if (++fetchedAlbums === expectedAlbums)
                            resolve();
                        return;
                    }
                    guysdone++;
                    if (!thing.tags.picture) {
                        if (thing.tags.album.length > 0 && thing.tags.album.trim() !== "Unknown Album") {
                            new Promise((resolve1, reject1) => {
                                if (albumsAskedFor.includes(thing.tags.album)) {
                                    resolve1();
                                    return;
                                }
                                albumsAskedFor.push(thing.tags.album);
                                findCoverFromApple(thing.tags.album, thing.tags.artist.substring(0, 8)).then((url = "") => {
                                    downloadImageFromWeb(thing.tags.album, thing.tags.artist, url).then((res) => {
                                        completed.push(thing.tags.album + thing.tags.artist);
                                        fs.appendFileSync(path.join(process.cwd(), "all.dat"), thing.tags.album + (thing.tags.artist ? "==" + thing.tags.artist : "") + "\r\n");
                                        appendSingleton(thing.tags.album, thing.tags.artist ? [thing.tags.artist] : []);
                                        resolve1(res);
                                    }).catch(() => {
                                        resolve1();
                                    });
                                }).catch((reason) => {
                                    reject1("Could not download art for " + thing.tags.album, reason);
                                });
                            }).then(() => {
                                if (++fetchedAlbums === expectedAlbums)
                                    resolve();
                            }).catch(() => {
                                if (++fetchedAlbums === expectedAlbums)
                                    resolve();
                            });
                        } else
                            expectedAlbums--;
                    } else {
                        const {data, format} = thing.tags.picture;
                        fs.writeFileSync(path.join(process.cwd(), "images/" + cleanUp(thing.tags.album) + cleanUp(thing.tags.artist) + "_raw.jpg"), Buffer.from(data));
                        completed.push(thing.tags.album + thing.tags.artist);
                        fs.appendFileSync(path.join(process.cwd(), "all.dat"), thing.tags.album + (thing.tags.artist ? "==" + thing.tags.artist : "") + "\r\n");
                        resizer(path.join(process.cwd(), "images/" + cleanUp(thing.tags.album) + cleanUp(thing.tags.artist) + "_raw.jpg")).resize({
                            height: 512,
                            width: 512
                        }).toFile(path.join(process.cwd(), "images/" + cleanUp(thing.tags.album) + cleanUp(thing.tags.artist) + ".jpg")).then(() => {
                            appendSingleton(thing.tags.album, thing.tags.artist ? [thing.tags.artist] : []);
                            fs.unlinkSync(path.join(process.cwd(), "images/" + cleanUp(thing.tags.album) + cleanUp(thing.tags.artist ? thing.tags.artist : "") + "_raw.jpg"));
                            if (++fetchedAlbums === expectedAlbums)
                                resolve();
                        }).catch(() => {
                            if (++fetchedAlbums === expectedAlbums)
                                resolve();
                        });
                    }
                }).catch(e => {
                    expectedAlbums--;
                    console.error(`Something went wrong reading art from ${file} ${e}`);
                });
            }
        }
        if (fetchedAlbums === expectedAlbums)
            resolve();
    });
}

function fetchAlbumsFromMP3(folder, file) {
    return new Promise((resolve, reject) => {
        new jsmediatags.Reader(folder + '\\' + file)
            .setTagsToRead(["artist", "album", "picture"])
            .read({
                onSuccess: function (tag) {
                    resolve(tag);
                },
                onError: function (error) {
                    guysFailed++;
                    reject(error);
                }
            });
    });
}

function appendSingleton(image, otherStuff = []) {
    fs.appendFileSync(findDat("spotify", version), image + "==" + (amountExported) + (otherStuff.length > 0 ? ('==' + otherStuff.join('==')) : "") + '\r\n');
    fs.appendFileSync(findDat("groove", version), image + "==" + (amountExported) + (otherStuff.length > 0 ? ('==' + otherStuff.join('==')) : "") + '\r\n');
    fs.appendFileSync(findDat("musicbee", version), image + "==" + (amountExported) + (otherStuff.length > 0 ? ('==' + otherStuff.join('==')) : "") + '\r\n');
    fs.copyFileSync(path.join(process.cwd(), "images/" + cleanUp(image) + cleanUp(otherStuff.join('')) + ".jpg"), path.join(process.cwd(), "spotify" + version + "/" + amountExported + ".jpg"));
    fs.copyFileSync(path.join(process.cwd(), "images/" + cleanUp(image) + cleanUp(otherStuff.join('')) + ".jpg"), path.join(process.cwd(), "groove" + version + "/" + amountExported + ".jpg"));
    fs.copyFileSync(path.join(process.cwd(), "images/" + cleanUp(image) + cleanUp(otherStuff.join('')) + ".jpg"), path.join(process.cwd(), "musicbee" + version + "/" + amountExported + ".jpg"));
    fs.unlinkSync(path.join(process.cwd(), "images/" + cleanUp(image) + cleanUp(otherStuff.join('')) + ".jpg"));
    amountExported++;
    if (amountExported > 296) {
        amountExported = 0;
        version++;
        createExportFolder("spotify");
        createExportFolder("groove");
        createExportFolder("musicbee");
    }
}

function cleanUp(instring) {
    return instring.replace(/[\\/?:<>|"*]/g, '');
}

function createExportFolder(playerName) {
    killDirectory(path.join(process.cwd(), playerName + version));
    fs.mkdirSync(path.join(process.cwd(), playerName + version));
    fs.copyFileSync(path.join(process.cwd(), "assets/paused.jpg"), path.join(process.cwd(), playerName + version + "/paused.png"));
    fs.copyFileSync(path.join(process.cwd(), "assets/" + playerName + "_small.png"), path.join(process.cwd(), playerName + version + "/" + playerName + "_small.png"));
    fs.copyFileSync(path.join(process.cwd(), "assets/" + playerName + ".png"), path.join(process.cwd(), playerName + version + "/" + playerName + ".png"));
    switch (playerName) {
        case 'spotify':
            fs.writeFileSync(path.join(process.cwd(), "spotify" + version + "/" + user + "spotify" + startTime + version + ".dat"), "spotify=spotify\nid=\n");
            break;
        case 'groove':
            fs.writeFileSync(path.join(process.cwd(), "groove" + version + "/" + user + "groove" + startTime + version + ".dat"), "music.ui=groove\nid=\n");
            break;
        case 'musicbee':
            fs.writeFileSync(path.join(process.cwd(), "musicbee" + version + "/" + user + "musicbee" + startTime + version + ".dat"), "musicbee=musicbee\nid=\n");
            break;
    }
}

function addImageKey(playerName, version, startTime, image, windex, extraStuff = []) {
    fs.appendFileSync(path.join(process.cwd(), playerName + version + "/" + user + playerName + startTime + version + ".dat"), image + '==' + windex + (extraStuff.length > 0 ? "==" + extraStuff.join('==') : "") + '\n');
    fs.copyFileSync(path.join(process.cwd(), "images/" + cleanUp(image) + ".jpg"), path.join(process.cwd(), playerName + version + "/" + windex + ".jpg"));
}

function killDirectory(location) {
    if (fs.existsSync(location)) {
        //fs.readdirSync(location).forEach(file => fs.unlinkSync(location + '/' + file));
        fs.rmdirSync(location, {
            recursive: true,
            maxRetries: 1,
            retryDelay: 100
        });
    }
}

function writeOverwritable(message = "") {
    try {
        if (message.length >= process.stdout.columns)
            message = message.substring(0, process.stdout.columns - 2);
        process.stdout.write(message + ' '.repeat(process.stdout.columns - 3 - message.length) + '\r');
    } catch (e) {
    }
}

function readLast() {
    if (fs.existsSync(path.join(process.cwd(), "archive"))) {
        fs.readdirSync(path.join(process.cwd(), "archive"))
            .forEach((file) => {
            fs.readFileSync(path.join(process.cwd(), "archive", file)).toString().split('\n').forEach(line => {
                line = line.replace('\r', '');
                if (line.includes('=='))
                    completed.push(line.split('==')[0] + (line.split('==').length > 2 ? line.split('==').splice(2).join("") : ""));
            });
        });
    }
    while (fs.existsSync(path.join(process.cwd(), "groove" + (++version)))) {
        amountExported = 0;
        fs.readdirSync(path.join(process.cwd(), "groove" + version)).forEach(file => {
            if (file.includes('.dat')) {
                fs.readFileSync(path.join(process.cwd(), "groove" + version, file)).toString().split('\n').forEach(line => {
                    line = line.replace('\r', '');
                    if (line.split('==').length > 1) {
                        completed.push(line.split('==')[0] + line.split('==').splice(2).join(""));
                        amountExported++;
                    }
                });
            }
        });
    }
    version = Math.max(version - 1, 0);
}

function findDat(player, vers) {
    return path.join(process.cwd(), player + vers, fs.readdirSync(path.join(process.cwd(), player + vers)).find(file => file.includes('.dat')));
}

process.on('unhandledRejection', (reason, p) => {
    console.trace('Unhandled Rejection at: Promise', p, 'reason:', reason);
});