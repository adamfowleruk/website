/*
 * Drupal 6 CSV dump->Hugo
 * (C) 2016 Augustin Cavalier
 *
 * NOTE: This script requires abou 2GB of RAM. nodejs limits you to 1.5GB by default.
 * Override it by running this script with "node --max_old_space_size=4096 drupal2hugo.js".
 */

var fs = require('fs');

function ParseCSV(csv) {
	var rows = [];
	for (var i = 0; i < csv.length; i++) {
		var row = [];
		for (; i < csv.length; i++) {
			if (csv[i] == '"') {
				i++;
				var itm = '', done = false;
				while (!done) {
					switch (csv[i]) {
					case '"':
						done = true;
						break;

					case '\\':
						i++;
						switch (csv[i]) {
						case "r":
							itm += "\r";
							break;
						case "n":
							itm += "\n";
							break;
						case "t":
							itm += "\t";
							break;
						case '"':
							itm += '"';
							break;
						case "\r":
							itm += "\r";
							break;
						case "\n":
							itm += "\n";
							break;
						case "\\":
							itm += "\\";
							break;
						default:
							console.log("WARN: unknown escape sequence: \\" + csv[i] + ", row[0] = ", row[0]);
							itm += csv[i];
							break;
						}
						break;

					default:
						itm += csv[i];
						break;
					}
					i++;
				}
				i--;
				row.push(itm);
			} else if (csv[i] == "\n") {
				break;
			}
		}
		rows.push(row);
	}
	return rows;
}

/* CSV dumps generated using:
 *    sudo mkdir /tmp/mysql_dump_dir/
 *    sudo chmod u=rwx,g=rwx,o=rwx /tmp/mysql_dump_dir/
 *    sudo mysqldump --fields-enclosed-by='"' --fields-terminated-by=',' --tab /tmp/mysql_dump_dir/ website_livesite
 */
var nodes = ParseCSV(fs.readFileSync('export/node.csv', {encoding: "UTF-8"})),
	node_revisions = ParseCSV(fs.readFileSync('export/node_revisions.csv', {encoding: "UTF-8"})),
	url_alias = ParseCSV(fs.readFileSync('export/url_alias.csv', {encoding: "UTF-8"}));

var term_data = ParseCSV(fs.readFileSync('export/term_data.csv', {encoding: "UTF-8"})),
	term_node = ParseCSV(fs.readFileSync('export/term_node.csv', {encoding: "UTF-8"})),
	TagMap = {};
// Create TagMap
for (var i in term_data)
	TagMap[term_data[i][0]] = term_data[i][2];
term_data = [];

var header_template =
`+++
type = "TYPE"
title = "TITLE"
date = "DATE"
tags = [TAGS]
+++`;
// author = "AUTHOR"

var base = "newsite/content";
function GetSavePath(path, type, node) {
	var countSlash = (path.match(/\//g) || []).length;
	if ((type == "blog" && countSlash == 3) ||
		(type == "content_news" && countSlash == 2)) {
		// Some old blog content had a "/" between the date and the post title
		// So we replace the last '/' with an '_'.
		path = path.substr(0, path.lastIndexOf("/")) + "_" + path.substr(path.lastIndexOf("/") + 1);
	}

	path = path.split("/");
	var ret = base;
	for (var i in path) {
		ret += "/" + path[i];
		if (fs.existsSync(ret)) {
			// Path exists. Are we at the end?
			if (i == (path.length - 1)) {
				// Check if there already is an 'index.html' file
				ret += "/index.html";
				if (fs.existsSync(ret)) {
					console.error("FATAL: could not find unused path for", path.join('/'), node);
					process.exit(1);
				} else // Nope, doesn't exist, so let's use it.
					break;
			} else // We aren't at the end, just continue.
				continue;
		} else {
			// Path does not exist. Are we at the end?
			if (i == (path.length - 1)) {
				// This is it.
				if (fs.existsSync(ret + ".html")) {
					console.error("FATAL: file already exists for", path.join('/'), node);
					process.exit(1);
				}
				ret += ".html";
				break;
			} else {
				// We aren't at the end, and the path does not exist. Create a directory.
				fs.mkdirSync(ret);
				// Is there a file with the name of the folder we just made?
				if (fs.existsSync(ret + ".html")) {
					// Make it the index.html of the subdirectory.
					fs.renameSync(ret + ".html", ret + "/index.html");
				}
			}
		}
	}
	return ret;
}
for (var i in nodes) {
	if (nodes[i][2] == "forum")
		continue;
	var node = nodes[i];
	var nid = node[0],
		type = node[2],
		title = node[3],
		isPublished = (node[5] == "1"),
		created = node[6],
		changed = node[7],
		content = undefined,
		url_dst = undefined,
		tags = [];
	if (!isPublished) {
		console.log("INFO: skipping nid" + nid + ", unpublished");
		continue;
	}
	for (var i in node_revisions) {
		if (node_revisions[i][0] != nid)
			continue;
		if (node_revisions[i][7] != changed)
			continue;
		content = node_revisions[i][4];
	}
	if (!content) {
		console.log("WARN: could not find content for nid" + nid);
		continue;
	}
	var url_src = 'node/' + nid;
	for (var i in url_alias) {
		if (url_alias[i][1] != url_src)
			continue;
		url_dst = url_alias[i][2];
		break;
	}
	if (!url_dst) {
		console.log("WARN: skipping nid" + nid + ", no url_dst");
		continue;
	}
	for (var i in term_node) {
		if (term_node[i][0] != nid)
			continue;
		var tag = TagMap[term_node[i][1]];
		if (tags.indexOf(tag) == -1)
			tags.push(tag);
	}

	var outfile = header_template + '\n\n';
	outfile = outfile
		.replace("TYPE", type == "blog" ? "blog" : "article") // FIXME: news
		.replace("TITLE", title.replace(/"/g, '\\"'))
		.replace("DATE", (new Date(parseInt(created) * 1000)).toISOString())
		.replace("TAGS", tags.length ? ('"' + tags.join('", "') + '"') : '');
	if (type == "blog") {
		var blogAuthor = url_dst.split('/')[1];
		if (blogAuthor == "pulkomandy")	blogAuthor = "PulkoMandy"; // HACK
		if (blogAuthor == "barrett")	blogAuthor = "Barrett"; // HACK
		outfile = outfile.replace("\ntitle", '\nauthor = "' + blogAuthor + '"\ntitle');
	}

	content = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	outfile += content;

	var file = GetSavePath(url_dst, type, node);
	console.log("INFO: writing (nid" + nid + ")", file);
	fs.writeFileSync(file, outfile);
}