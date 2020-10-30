const config = require('config');
const Ldapper = require('ldapper').Ldapper;


async function main () {

  const ldap = config.ldap;

  if (!Array.isArray(ldap.options.domainControllers))
  ldap.options.domainControllers = [ldap.options.domainControllers];


  const ldappermanager = new Ldapper(ldap.options);
  const items = await ldappermanager.find(ldap.filter);

  let i=1;
  for (const item of items)
    if (item.sAMAccountName && item.givenName && item.sn && item.mail)
      console.log(i++, item.sAMAccountName.toLowerCase(), item.givenName, item.sn, item.mail);
}

main().catch(e => console.error(e));
