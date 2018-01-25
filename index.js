const config = require('config');
const Ldapper = require('ldapper').Ldapper;
const got = require('got');
const pEachSeries = require('p-each-series');
const minimist = require('minimist');

const argv = minimist(process.argv.slice(2), {
  boolean: ['dryRun'],
  alias: {'dry-run': 'dryRun'}
});

const redmine = config.redmine;
const ldap = config.ldap;

if (!redmine || !ldap) throw new Error('Nepilnīga konfiguracija');

const headers = {'X-Redmine-API-Key': redmine.apiKey};

const itemGroups = new class Groups {
  add(name, userId) {
    if (!this[name]) this[name] = [];
    this[name].push(userId);
  }
}();

console.log(`AD ${ldap.options.domainControllers} ${ldap.filter} => ${redmine.endpoint}`);
findItems()
  .then(items => {
    console.log('Push users...');
    return pEachSeries(items, processItem);
  })
  .then(() => getGroups())
  .then(groups => {
    console.log('Push groups...');
    return pEachSeries(Object.entries(itemGroups), processItemGroupWrap.bind(this, groups));
  })
  .catch(err => console.error('ERROR', err));

function processItemGroupWrap(groups, [name, itemIds]) {
  processItemGroup(groups, [name, itemIds]).then(action => console.log(action, name));
}

function processItemGroup(groups, [name, itemIds]) {
  const group = groups.find(group => group.name == name);
  if (!group) return addnewGroup(name, itemIds).then(() => '+++');
  return getGroupUsers(group.id).then(users => {
    const userIds = users.map(user => user.id);
    if (!equal(userIds, itemIds)) return updateGroup(group.id, itemIds).then(() => '===');
    return '---';
  });
}

function findItems() {
  // pielaboju iespējamo konfiga nepilnību
  if (!Array.isArray(ldap.options.domainControllers))
    ldap.options.domainControllers = [ldap.options.domainControllers];
  const ldappermanager = new Ldapper(ldap.options);
  return ldappermanager.find(ldap.filter);
}

function processItem(item) {
  if (!item.givenName || !item.sn || !item.mail || !item[redmine.groupby])
    return console.log('   ', item.sAMAccountName);
  return getUser(item)
    .then(user => {
      if (!user)
        return addnewUser(item).then(user => {
          itemGroups.add(item[redmine.groupby], user.id);
          return '+++';
        });
      itemGroups.add(item[redmine.groupby], user.id);
      const diff = getDiff(user, item);
      if (Object.keys(diff).length) return updateUser(user, diff).then(() => '===');
      return '---';
    })
    .then(action => console.log(action, item.sAMAccountName));
}

// pārbaudu pa vienam laukam un savācu starpības
function getDiff(user, item) {
  const changes = {};
  const login = item.sAMAccountName.toLowerCase();
  if (user.login != login) changes.login = login;
  if (user.firstname != item.givenName) changes.firstname = item.givenName;
  if (user.lastname != item.sn) changes.lastname = item.sn;
  for (const [key, id] of Object.entries(redmine.fields || {})) {
    const custom = getCustomField(user, id);
    if (!custom || custom.value != item[key]) changes[id] = item[key];
  }
  return changes;
}

function getCustomField(user, id) {
  if (!user || !user.custom_fields) return null;
  return user.custom_fields.find(i => i.id == id);
}

function getUser(item) {
  return got(`${redmine.endpoint}/users.json?name=${item.mail}`, {
    json: true,
    headers
  }).then(res => (res.body.users.length ? res.body.users[0] : null));
}

function updateUser(user, changes) {
  const body = {user: {custom_fields: []}};
  for (const [id, value] of Object.entries(changes)) {
    if (parseInt(id, 10)) {
      body.user.custom_fields.push({id, value});
    } else {
      body.user[id] = value;
    }
  }
  if (!body.user.custom_fields.length) delete body.user.custom_fields;
  if (argv.dryRun) return Promise.resolve({});
  return got
    .put(`${redmine.endpoint}/users/${user.id}.json`, {json: true, body, headers})
    .then(res => res.body.user);
}

function addnewUser(item) {
  const body = {
    user: {
      login: item.sAMAccountName.toLowerCase(),
      firstname: item.givenName,
      lastname: item.sn,
      mail: item.mail.toLowerCase(),
      auth_source_id: redmine.authId, // AD auth
      custom_fields: []
    }
  };
  for (const [key, id] of Object.entries(redmine.fields || {})) {
    body.user.custom_fields.push({id, value: item[key]});
  }
  if (!body.user.custom_fields.length) delete body.user.custom_fields;
  if (argv.dryRun) return Promise.resolve({});
  return got
    .post(`${redmine.endpoint}/users.json`, {json: true, body, headers})
    .then(res => res.body.user);
}

function getGroups() {
  return got(`${redmine.endpoint}/groups.json?include=users`, {
    json: true,
    headers
  }).then(res => res.body.groups);
}

function getGroupUsers(id) {
  return got(`${redmine.endpoint}/groups/${id}.json?include=users`, {
    json: true,
    headers
  }).then(res => {
    return res.body.group.users;
  });
}

function updateGroup(groupId, user_ids) {
  const body = {group: {user_ids}};
  if (argv.dryRun) return Promise.resolve({});
  return got
    .put(`${redmine.endpoint}/groups/${groupId}.json`, {json: true, body, headers})
    .then(res => res.body.user);
}

function addnewGroup(name, user_ids) {
  const body = {group: {name, user_ids}};
  if (argv.dryRun) return Promise.resolve(body.group);
  return got
    .post(`${redmine.endpoint}/groups.json`, {json: true, body, headers})
    .then(res => res.body.group);
}

function equal(arr1, arr2) {
  return arr1.sort().join('') === arr2.sort().join('');
}
