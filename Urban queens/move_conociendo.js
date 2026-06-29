const fs = require('fs');
const path = require('path');
const htmlPath = path.join(__dirname, 'public', 'control.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const regexRogue = /<\/div>\s*<\/div>\s*<\/div>\s*<div class="card">\s*<div class="card-title">\s*👑 <span class="card-title-accent">Conociendo a mi Queen<\/span>[\s\S]*?<button class="btn btn-danger btn-full"[\s\S]*?<\/div>\s*<\/div>/;

const extractedCardMatch = html.match(/(<div class="card">\s*<div class="card-title">\s*👑 <span class="card-title-accent">Conociendo a mi Queen<\/span>[\s\S]*?<button class="btn btn-danger btn-full"[\s\S]*?<\/div>\s*<\/div>)/);

if(regexRogue.test(html) && extractedCardMatch) {
    const cardHtml = extractedCardMatch[1];
    // Remove the rogue card completely
    html = html.replace(regexRogue, '</div>\n                </div>\n            </div>');
    
    // Now we need to insert it back into tab-batallas.
    // tab-batallas ends before <!-- ══ CLÁSICO ══ -->
    // So let's insert the card just before <!-- ══ CLÁSICO ══ -->, inside the tab-batallas div.
    
    // Wait, the structure is:
    //         <div id="tab-batallas" class="tab-content active">
    //             ...
    //             <div class="card">
    //                  ... (some card)
    //             </div>
    //         </div>
    //         <!-- ══ CLÁSICO ══ -->
    
    // So let's insert it right before the </div> that precedes <!-- ══ CLÁSICO ══ -->
    const targetRegex = /<\/div>\s*<!-- ══ CLÁSICO ══ -->/;
    if(targetRegex.test(html)) {
        html = html.replace(targetRegex, '\n' + cardHtml + '\n            </div>\n            <!-- ══ CLÁSICO ══ -->');
        fs.writeFileSync(htmlPath, html);
        console.log("Moved Conociendo a mi Queen back to tab-batallas");
    } else {
        console.log("Could not find the end of tab-batallas");
    }
} else {
    console.log("Regex not matched for rogue card");
}
