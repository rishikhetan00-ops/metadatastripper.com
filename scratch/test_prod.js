async function checkProd() {
  const res = await fetch('https://metadatastripper-com.vercel.app');
  const html = await res.text();

  console.log('--- Production HTML Inspection ---');
  console.log('filename.jpg in HTML:', html.includes('filename.jpg'));
  console.log('2.4 MB in HTML:', html.includes('2.4 MB'));
  console.log('Privacy Warning in HTML:', html.includes('Privacy Warning'));
  console.log('document.pdf in HTML:', html.includes('document.pdf'));

  const jsLinks = html.match(/\/_\/astro\/[^\"]+/g) || html.match(/\/_\/astro\/[^\"]+/g) || [];
  const scriptSrcs = [];
  const re = /src="(\/_astro\/[^"]+)"/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    scriptSrcs.push(match[1]);
  }

  for (const src of scriptSrcs) {
    const jsUrl = 'https://metadatastripper-com.vercel.app' + src;
    const jsRes = await fetch(jsUrl);
    const jsText = await jsRes.text();
    console.log(`--- JS Bundle: ${src} ---`);
    console.log('  filename.jpg:', jsText.includes('filename.jpg'));
    console.log('  2.4 MB:', jsText.includes('2.4 MB'));
    console.log('  Privacy Warning:', jsText.includes('Privacy Warning'));
  }
}

checkProd().catch(console.error);
