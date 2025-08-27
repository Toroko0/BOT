const db = require('./database');
const Knex = require('knex');

// Mock the logger to prevent console output during tests
jest.mock('./utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('Database Functions', () => {
  let knex;

  beforeAll(async () => {
    knex = Knex({
      client: 'sqlite3',
      connection: {
        filename: ':memory:',
      },
      useNullAsDefault: true,
    });
    db.setKnexInstance(knex); // Override the knex instance in the database module

    // Manually create schema to match production
    await knex.schema.createTable('users', (table) => {
      table.string('id').primary();
      table.string('username').notNullable();
    });
    await knex.schema.createTable('worlds', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.integer('days_owned').defaultTo(1);
      table.timestamp('expiry_date').notNullable();
      table.enu('lock_type', ['mainlock', 'outlock']).defaultTo('mainlock');
      table.string('custom_id').unique();
      table.string('added_by_username');
      table.timestamp('added_date');
      table.string('user_id').references('id').inTable('users');
    });
  });

  afterAll(async () => {
    await knex.destroy();
  });

  beforeEach(async () => {
    // Clear all tables before each test
    await knex('worlds').del();
    await knex('users').del();
  });

  describe('addWorld', () => {
    it('should add a world with a custom_id', async () => {
      await db.addUser('123', 'testuser');
      const result = await db.addWorld('TESTWORLD', 1, 'mainlock', 'MYID', 'testuser');
      expect(result.success).toBe(true);
      expect(result.world.name).toBe('TESTWORLD');
      expect(result.world.custom_id).toBe('MYID');

      const world = await db.getWorldByCustomId('MYID');
      expect(world).toBeDefined();
      expect(world.name).toBe('TESTWORLD');
    });

    it('should fail to add a world with a duplicate custom_id', async () => {
      await db.addUser('123', 'testuser');
      await db.addWorld('TESTWORLD1', 1, 'mainlock', 'MYID', 'testuser');
      const result = await db.addWorld('TESTWORLD2', 1, 'mainlock', 'MYID', 'testuser');
      expect(result.success).toBe(false);
      expect(result.message).toContain('This world conflicts with an existing one (e.g., same name or custom ID).');
    });
  });

  describe('updateWorld', () => {
    it('should update a world with a new custom_id', async () => {
      await db.addUser('123', 'testuser');
      const addResult = await db.addWorld('TESTWORLD', 1, 'mainlock', 'OLDID', 'testuser');
      const worldId = addResult.world.id;

      const updatedData = {
        daysOwned: 10,
        lockType: 'outlock',
        custom_id: 'NEWID',
      };
      await db.updateWorld(worldId, updatedData);

      const updatedWorld = await db.getWorldById(worldId);
      expect(updatedWorld.custom_id).toBe('NEWID');
      expect(updatedWorld.days_owned).toBe(10);
      expect(updatedWorld.lock_type).toBe('outlock');
    });
  });

  describe('getWorldByCustomId', () => {
    it('should retrieve a world by its custom_id', async () => {
      await db.addUser('123', 'testuser');
      await db.addWorld('TESTWORLD', 1, 'mainlock', 'MYID', 'testuser');

      const world = await db.getWorldByCustomId('MYID');
      expect(world).toBeDefined();
      expect(world.name).toBe('TESTWORLD');
    });

    it('should return null if no world is found with the given custom_id', async () => {
      const world = await db.getWorldByCustomId('NONEXISTENT');
      expect(world).toBeNull();
    });
  });
});
