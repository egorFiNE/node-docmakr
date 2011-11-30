fs = require('fs');
util = require('util');
markdown = require(__dirname+'/markdown');
var optimist = require('optimist')
	.options('out', {
		describe: 'path to output html files',
		demand: true
	})
	.options('md', {
		'boolean': true,
		describe: 'generate also Markdown *.md files'
	})
	.usage("Run: doc.js [args] File.js");
	
var argv=optimist.argv;

if (argv._.length<=0) {
	console.log("Wrong usage.\n");
	optimist.showHelp();
	return;
} 


var tocEntryTemplate = '* <a href="#{anchor}">{title}</a>';
var paramTemplate = '* <code><span class="type">{type}</span></code> <code>**{name}**</code> &#8212; {doc}';
var paramUnknownTemplate = '* <code>**{name}**</code> &#8212; {doc}';
var returnTemplate = 'Returns:\n\n* <code><span class="type">{type}</span></code> {doc}';
var returnUnknownTemplate = 'Returns:\n\n* {doc}';
var methodTemplate = '### <a name="{anchor}"></a> {name}({parameters})';
var staticMethodTemplate = '### {class}.{name}({parameters})  <span class="static">static</span>';
var classTemplate = '## <span class="class">{name}({parameters})</span>';

var htmlTemplate = fs.readFileSync(__dirname+'/template.html').toString();

var Types = {
	CLASS: 'class',
	METHOD: 'method',
	STATIC_METHOD: 'static_method'
}

var filename = argv._[0];

var data = fs.readFileSync(filename).toString();

var filenameMd = filename.replace('.js', '.md');
var md = generateDoc(filename, data);
if (argv.md) {
	fs.writeFileSync(argv.out+'/'+filenameMd, md);
}

var filenameHtml = filename.replace('.js', '.html');
var html = markdown.toHTML(markdown.parse(md), {xhtml:false});
html = html
	.replace(/<hr><\/hr>/g, "<hr />");

html = template(htmlTemplate, {
	title: filename,
	body: html
});

fs.writeFileSync(argv.out+'/'+filenameHtml, html);

function generateAnchor(type, name, parameters) {
	name = name || '';
	parameters = parameters || '';
	parameters = parameters.replace(/\s+/g, 'Q');
	parameters = parameters.replace(/,/g, 'Q');
	parameters = parameters.replace(/,/g, 'Q');
	parameters = parameters.toLowerCase();
	name = name.toLowerCase();
	var anchor =  type+'Q'+name+'Q'+parameters;
	anchor = anchor.replace(/_/g, 'Q');
	return stripHtml(anchor);
}

function stripHtml(str) { 
	return str.replace(/<[^>+]>/g, '');
}

function generateDoc(filename, data) {
	var lines = data.split("\n");

	var _inComment = false, currentComment = [], currentMatch=null;

	var lastClassName = null;

	var documentation = [];

	lines.forEach(function(line) {
		//line=line.replace(/^\s+/g, '');
		
		if (line.match(/^\s*\/\*\*/)) {
			_inComment = true;
			currentComment = [];
			
		} else if (line.match(/^\s*\*\//)) {
			_inComment = false;
			
		} else if (_inComment) {
			currentComment.push(line);
				
		} else if ((currentMatch=line.match(/^\s*function\s+([^\(]+)\s*\((.*)\)/))) {
			var name = currentMatch[1].trim();

			var firstLetter = name.substr(0,1);
			if (firstLetter.match(/[A-Z]/)) {
				var parameters = currentMatch[2].trim();
				var anchor = generateAnchor(Types.CLASS, name, parameters);
				documentation.push({
					declaration: line,
					name: name,
					parameters: parameters,
					type: Types.CLASS,
					comment: currentComment,
					anchor: anchor
				});
				
				lastClassName=name;
			}

			currentComment = [];
			
		} else if ((currentMatch=line.match(/^\s*[^\.]+\.prototype\.([^\.]+)\s*=\s*function\s*\((.*)\)/))) {
			var parameters = currentMatch[2].trim();
			var name = currentMatch[1].trim();
			var anchor = generateAnchor(Types.METHOD, name, parameters);
			documentation.push({
				declaration: line,
				parameters: parameters,
				name: name,
				type: Types.METHOD,
				comment: currentComment,
				anchor: anchor
			});
			
			currentComment = [];
			
		} else if ((currentMatch=line.match(/^\s*[^\.]+\.([^\.]+)\s*=\s*function\s*\((.*)\)/))) {
			var parameters = currentMatch[2].trim();
			var name = currentMatch[1].trim();
			var anchor = generateAnchor(Types.STATIC_METHOD, name, parameters);
			documentation.push({
				declaration: line,
				parameters: parameters,
				name: name,
				type: Types.STATIC_METHOD,
				comment: currentComment,
				anchor: anchor
			});
			
			currentComment = [];
		}
	});

	var out="# "+filename+"\n\n";

	var toc = [];
	documentation.forEach(function(entry) {
		var parameters = entry.parameters.split(/,\s*/);
		entry.parametersFormatted = formatParameters(parameters);
		entry.parsedComments = parseComments(entry.comment);
		if (entry.parsedComments.flags.pvt || entry.name.substr(0,1)=='_') {
			entry.pvt = true;
		}
	});

	documentation.forEach(function(entry) {
		var title = stripHtml(entry.name+"("+entry.parameters+")");
		var tocEntry = template(tocEntryTemplate, {
			title: title,
			anchor: entry.anchor,
		});

		if (!entry.pvt) { 
			toc.push(tocEntry);
		}
	});
	toc = toc.join("\n")+"\n\n";

	out+=toc;

	documentation.forEach(function(entry) {
		if (entry.pvt) {
			return;
		}

		if (entry.type == Types.CLASS) {
			out+=template(classTemplate, {
				name: entry.name,
				anchor: entry.anchor,
				parameters: entry.parametersFormatted
			});

		} else if (entry.type==Types.METHOD) {
			out+=template(methodTemplate, {
				name: entry.name,
				anchor: entry.anchor,
				parameters: entry.parametersFormatted
			});

		} else if (entry.type == Types.STATIC_METHOD) {
			out+=template(staticMethodTemplate, {
				class: lastClassName,
				name: entry.name,
				anchor: entry.anchor,
				parameters: entry.parametersFormatted
			});
		}

		out+="\n\n";

		if (entry.parsedComments.text) { 
			out+=entry.parsedComments.text;
			out+="\n\n";
		}
	});

	return out;
}

//console.log(util.inspect(documentation));

function parseComments(comments) {
	var flags = {};
	
	var newComments = [];
	comments.forEach(function(line) {
		var currentMatch=null;

		if ((currentMatch=line.match(/^\s*\@param\s+{(.+)}\s+([^\s]+)\s+(.+)$/))) {
			newComments.push(template(
				paramTemplate,
				{ 
					name: currentMatch[2],
					type: currentMatch[1],
					doc: currentMatch[3]
				}
			));

		} else if ((currentMatch=line.match(/^\s*\@param\s+([^\s]+)\s+(.+)$/))) {
			newComments.push(template(
				paramUnknownTemplate,
				{ 
					name: currentMatch[1],
					type: '',
					doc: currentMatch[2]
				}
			));

		} else if ((currentMatch=line.match(/^\s*\@return\s+(.+)$/))) {
			var restLine = currentMatch[1];
			var type = '(unknown)', doc=restLine, _template = returnUnknownTemplate;

			if ((currentMatch=restLine.match(/{(.+)}\s*(.*)$/))) {
				type=currentMatch[1];
				doc=currentMatch[2].trim();
				_template = returnTemplate;
			}

			newComments.push(template(
				"\n"+_template,
				{ 
					type: type,
					doc: doc
				}
			));
			
		} else if (line.match(/^\s*\@private/)) {
			flags.pvt=true;

		} else { 
			newComments.push(line);
		}
	});
	
	return {
		text: newComments.join("\n"),
		flags: flags
	};
}

function template(template, args) {
	Object.keys(args).forEach(function(name) {
		template = template.replace(new RegExp('{'+name+'}', 'gi'), args[name]);
	});
	return template;
}


function formatParameters(parameters) {
	var newParameters = parameters.filter(function(parameter) {
		return parameter!='';
	});

	newParameters = newParameters.map(function(parameter) {
		return '<span class="parameter">'+parameter+'</span>';
	});

	return newParameters.join(', ');
}
