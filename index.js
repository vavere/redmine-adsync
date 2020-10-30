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

const validUsers = [];

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
  .then(() => getUsers())
  .then(users => {
    console.log('Lock users...');
    return pEachSeries(users, processUser);
  })
  .catch(err => console.error('ERROR', err));

function processUser(user) {
  if (!validUsers.includes(user.id) && user.auth_source_id && user.auth_source_id == redmine.authId) {
      console.log('   ', user.login);
      if (argv.dryRun) return Promise.resolve({});
      return lockUser(user.id);
  }
}

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
  if (item.sAMAccountName == 'dace.rutka') {
    console.log('STOP')
  }
  if (!item.givenName || !item.sn || !item.mail || !item[redmine.groupby])
    return console.log('   ', item.sAMAccountName || 'NULL');
  return Promise.all([fundUserByName(item.mail), fundUserByName(item.sAMAccountName)])
    .then(([user, user2]) => {
      if (!user && user2) user = user2;  //spec gadījums kad izmainīts epasts bet nav mainīts login
      if (!user)
        return addnewUser(item).then(user => {
          itemGroups.add(item[redmine.groupby], user.id);
          validUsers.push(user.id);
          return ['+++', ''];
        });
      itemGroups.add(item[redmine.groupby], user.id);
      validUsers.push(user.id);
      return getUser(user.id)
      .then(user => {
        const diff = getDiff(user, item);
        if (Object.keys(diff).length) return updateUser(user, diff).then(() => ['===', JSON.stringify(diff)]);
        return ['---', ''];
      })
    })
    .then(action => console.log(action[0], item.sAMAccountName, action[1]));
}

// pārbaudu pa vienam laukam un savācu starpības
function getDiff(user, item) {
  const changes = {};
  const login = replaceAccents(item.sAMAccountName).toLowerCase();
  const mail = item.mail.toLowerCase();
  if (user.login != login) changes.login = login;
  if (user.mail != mail) changes.mail = mail;
  if (user.firstname != item.givenName) changes.firstname = item.givenName;
  if (user.lastname != item.sn) changes.lastname = item.sn;
  if (user.status != 1) changes.status = 1;
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


function fundUserByName(name) {
  return fundUserByNameRaw(name, 1)  // active
  .then(user => {
    if (user) return user;
    return fundUserByNameRaw(name, 3)  // locked
  })
}

function fundUserByNameRaw(name, status = 1) {
  return got(`${redmine.endpoint}/users.json?status=${status}&name=${name}`, {
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
      login: replaceAccents(item.sAMAccountName).toLowerCase(),
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

function getUsers(seed = [], offset = 0) {
  const limit = 100;  // redmine default
  return getUsersRaw(offset, limit)
    .then(users => {
      const result = seed.concat(users);
      if (users.length == limit) {
        return getUsers(result, offset + limit);
      } else {
        return result;
      }
  });
}

function getUsersRaw(offset, limit) {
  return got(`${redmine.endpoint}/users.json?status=1&offset=${offset}&limit=${limit}`, {
    json: true,
    headers
  }).then(res => res.body.users);
}

function lockUser(id) {
  const body = {user: {status: 3}};  // LOCKED
  return got.put(`${redmine.endpoint}/users/${id}.json`, {json: true, body, headers})
}

function getUser(id) {
  return got(`${redmine.endpoint}/users/${id}.json`, {
    json: true,
    headers
  }).then(res => res.body.user);
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

function replaceAccents(s) {
  const acc = 'ĀČĒĢĪĶĻŅŠŪŽāčēģīķļņšūž'.split('');
  const lat = 'ACEGIKLNSUZacegiklnsuz'.split('');
  const map = {};
  acc.forEach((c, i) => (map[c] = lat[i]));
  return s.replace(/[^A-Za-z0-9]/g, c => map[c] || c);
}
