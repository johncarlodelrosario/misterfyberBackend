import mongoose from 'mongoose';
import logger from '../utils/logger';

interface DatabaseConfig {
    uri: string;
    options: mongoose.ConnectOptions;
}

class Database {
    private static instance: Database;
    private isConnected: boolean = false;
    private connectionRetries: number = 0;
    private maxRetries: number = 5;
    private retryDelay: number = 5000; // 5 seconds

    private constructor() {}

    public static getInstance(): Database {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance;
    }

    private getConfig(): DatabaseConfig {
        const baseOptions: mongoose.ConnectOptions = {
            autoIndex: process.env.NODE_ENV === 'development',
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            family: 4,
            maxPoolSize: 10,
            minPoolSize: 2,
            maxIdleTimeMS: 10000,
            connectTimeoutMS: 10000,
            heartbeatFrequencyMS: 30000,
            retryWrites: true,
            retryReads: true,
        };

        // Add authentication if provided
        if (process.env.MONGODB_USER && process.env.MONGODB_PASS) {
            baseOptions.auth = {
                username: process.env.MONGODB_USER,
                password: process.env.MONGODB_PASS
            };
            baseOptions.authSource = process.env.MONGODB_AUTH_SOURCE || 'admin';
        }

        return {
            uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/isp_management',
            options: baseOptions
        };
    }

    private setupEventListeners(): void {
        mongoose.connection.on('connected', () => {
            logger.info('MongoDB connected successfully');
            this.isConnected = true;
            this.connectionRetries = 0;
        });

        mongoose.connection.on('error', (err) => {
            logger.error('MongoDB connection error:', err);
            this.isConnected = false;
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('MongoDB disconnected');
            this.isConnected = false;
            this.handleDisconnection();
        });

        mongoose.connection.on('reconnected', () => {
            logger.info('MongoDB reconnected');
            this.isConnected = true;
        });

        mongoose.connection.on('reconnectFailed', () => {
            logger.error('MongoDB reconnection failed');
            this.handleReconnectFailure();
        });

        // Graceful shutdown
        process.on('SIGINT', this.gracefulShutdown.bind(this));
        process.on('SIGTERM', this.gracefulShutdown.bind(this));
    }

    private async handleDisconnection(): Promise<void> {
        if (this.connectionRetries < this.maxRetries) {
            this.connectionRetries++;
            logger.info(`Attempting to reconnect (${this.connectionRetries}/${this.maxRetries})...`);
            
            setTimeout(async () => {
                try {
                    await this.connect();
                } catch (error) {
                    logger.error('Reconnection attempt failed:', error);
                }
            }, this.retryDelay * this.connectionRetries);
        } else {
            logger.error('Max reconnection attempts reached. Exiting...');
            process.exit(1);
        }
    }

    private handleReconnectFailure(): void {
        logger.error('Failed to reconnect to MongoDB. Please check your database server.');
        // You might want to implement additional notification here
    }

    private async gracefulShutdown(): Promise<void> {
        try {
            await mongoose.connection.close();
            logger.info('MongoDB connection closed through app termination');
            process.exit(0);
        } catch (err) {
            logger.error('Error during graceful shutdown:', err);
            process.exit(1);
        }
    }

    public async connect(): Promise<void> {
        try {
            if (this.isConnected) {
                logger.info('Using existing database connection');
                return;
            }

            const config = this.getConfig();
            
            logger.info('Connecting to MongoDB...');
            
            await mongoose.connect(config.uri, config.options);
            
            this.setupEventListeners();
            
            // Create indexes
            await this.createIndexes();

            logger.info('Database connection established');
        } catch (error) {
            logger.error('Failed to connect to MongoDB:', error);
            throw error;
        }
    }

    private async createIndexes(): Promise<void> {
        try {
            const db = mongoose.connection.db;
            if (!db) {
                throw new Error('Database connection not established');
            }

            // Get all collections
            const collections = await db.listCollections().toArray();
            const collectionNames = collections.map(c => c.name);

            // User indexes
            if (collectionNames.includes('users')) {
                const usersCollection = db.collection('users');
                
                // Check if indexes exist before creating
                const userIndexes = await usersCollection.indexes();
                const userIndexNames = userIndexes.map(idx => idx.name);

                if (!userIndexNames.includes('email_1')) {
                    await usersCollection.createIndex({ email: 1 }, { unique: true });
                    logger.info('Created email index on users');
                }
                
                if (!userIndexNames.includes('username_1')) {
                    await usersCollection.createIndex({ username: 1 }, { unique: true });
                    logger.info('Created username index on users');
                }
                
                if (!userIndexNames.includes('status_1')) {
                    await usersCollection.createIndex({ status: 1 });
                    logger.info('Created status index on users');
                }
                
                if (!userIndexNames.includes('role_1')) {
                    await usersCollection.createIndex({ role: 1 });
                    logger.info('Created role index on users');
                }
                
                // Compound indexes
                if (!userIndexNames.includes('status_1_role_1')) {
                    await usersCollection.createIndex({ status: 1, role: 1 });
                    logger.info('Created compound index on users');
                }
            }

            // Plan indexes
            if (collectionNames.includes('plans')) {
                const plansCollection = db.collection('plans');
                
                const planIndexes = await plansCollection.indexes();
                const planIndexNames = planIndexes.map(idx => idx.name);

                if (!planIndexNames.includes('name_1')) {
                    await plansCollection.createIndex({ name: 1 }, { unique: true });
                    logger.info('Created name index on plans');
                }
                
                if (!planIndexNames.includes('isActive_1')) {
                    await plansCollection.createIndex({ isActive: 1 });
                    logger.info('Created isActive index on plans');
                }
                
                if (!planIndexNames.includes('price_1')) {
                    await plansCollection.createIndex({ price: 1 });
                    logger.info('Created price index on plans');
                }
            }

            // Payment indexes
            if (collectionNames.includes('payments')) {
                const paymentsCollection = db.collection('payments');
                
                const paymentIndexes = await paymentsCollection.indexes();
                const paymentIndexNames = paymentIndexes.map(idx => idx.name);

                if (!paymentIndexNames.includes('userId_1_createdAt_-1')) {
                    await paymentsCollection.createIndex({ userId: 1, createdAt: -1 });
                    logger.info('Created userId+createdAt index on payments');
                }
                
                if (!paymentIndexNames.includes('status_1')) {
                    await paymentsCollection.createIndex({ status: 1 });
                    logger.info('Created status index on payments');
                }
                
                if (!paymentIndexNames.includes('referenceNumber_1')) {
                    await paymentsCollection.createIndex({ referenceNumber: 1 }, { unique: true });
                    logger.info('Created referenceNumber index on payments');
                }
                
                if (!paymentIndexNames.includes('transactionId_1')) {
                    await paymentsCollection.createIndex({ transactionId: 1 });
                    logger.info('Created transactionId index on payments');
                }
            }

            // Billing indexes
            if (collectionNames.includes('billings')) {
                const billingsCollection = db.collection('billings');
                
                const billingIndexes = await billingsCollection.indexes();
                const billingIndexNames = billingIndexes.map(idx => idx.name);

                if (!billingIndexNames.includes('userId_1_dueDate_-1')) {
                    await billingsCollection.createIndex({ userId: 1, dueDate: -1 });
                    logger.info('Created userId+dueDate index on billings');
                }
                
                if (!billingIndexNames.includes('status_1')) {
                    await billingsCollection.createIndex({ status: 1 });
                    logger.info('Created status index on billings');
                }
                
                if (!billingIndexNames.includes('invoiceNumber_1')) {
                    await billingsCollection.createIndex({ invoiceNumber: 1 }, { unique: true });
                    logger.info('Created invoiceNumber index on billings');
                }
                
                if (!billingIndexNames.includes('dueDate_1')) {
                    await billingsCollection.createIndex({ dueDate: 1 });
                    logger.info('Created dueDate index on billings');
                }
            }

            // MikroTik Config indexes
            if (collectionNames.includes('mikrotikconfigs')) {
                const mikrotikCollection = db.collection('mikrotikconfigs');
                
                const mikrotikIndexes = await mikrotikCollection.indexes();
                const mikrotikIndexNames = mikrotikIndexes.map(idx => idx.name);

                if (!mikrotikIndexNames.includes('isActive_1')) {
                    await mikrotikCollection.createIndex({ isActive: 1 });
                    logger.info('Created isActive index on mikrotikconfigs');
                }
                
                if (!mikrotikIndexNames.includes('host_1')) {
                    await mikrotikCollection.createIndex({ host: 1 }, { unique: true });
                    logger.info('Created host index on mikrotikconfigs');
                }
            }

            // Notification indexes
            if (collectionNames.includes('notifications')) {
                const notificationsCollection = db.collection('notifications');
                
                const notificationIndexes = await notificationsCollection.indexes();
                const notificationIndexNames = notificationIndexes.map(idx => idx.name);

                if (!notificationIndexNames.includes('userId_1_createdAt_-1')) {
                    await notificationsCollection.createIndex({ userId: 1, createdAt: -1 });
                    logger.info('Created userId+createdAt index on notifications');
                }
                
                if (!notificationIndexNames.includes('isRead_1')) {
                    await notificationsCollection.createIndex({ isRead: 1 });
                    logger.info('Created isRead index on notifications');
                }
            }

            logger.info('All database indexes created successfully');
        } catch (error) {
            logger.error('Error creating indexes:', error);
            // Don't throw error - indexes are not critical for application startup
        }
    }

    public async disconnect(): Promise<void> {
        try {
            await mongoose.connection.close();
            this.isConnected = false;
            logger.info('Database disconnected');
        } catch (error) {
            logger.error('Error disconnecting from database:', error);
            throw error;
        }
    }

    public getConnectionStatus(): boolean {
        return this.isConnected;
    }

    public async healthCheck(): Promise<{
        status: 'healthy' | 'unhealthy';
        latency: number;
        connections: number;
    }> {
        const start = Date.now();
        
        try {
            // Execute a simple command to check connection
            await mongoose.connection.db.admin().ping();
            
            const latency = Date.now() - start;
            // Fix for the client property error
            const connections = mongoose.connection.readyState === 1 ? 1 : 0;
            
            return {
                status: 'healthy',
                latency,
                connections
            };
        } catch (error) {
            logger.error('Database health check failed:', error);
            return {
                status: 'unhealthy',
                latency: Date.now() - start,
                connections: 0
            };
        }
    }

    public async backup(): Promise<string> {
        // This would implement database backup
        // For production, you'd use mongodump or a backup service
        const backupPath = `./backups/mongodb-${new Date().toISOString()}.gz`;
        logger.info(`Database backup initiated to ${backupPath}`);
        
        // Implementation would depend on your backup strategy
        // Could use child_process to run mongodump
        
        return backupPath;
    }

    public async restore(backupPath: string): Promise<void> {
        // This would implement database restore
        logger.info(`Restoring database from ${backupPath}`);
        
        // Implementation would depend on your backup strategy
        // Could use child_process to run mongorestore
    }
}

// Export singleton instance
export default Database.getInstance();

// Export connection function for easy use
export const connectDB = async (): Promise<void> => {
    const db = Database.getInstance();
    await db.connect();
};

// Export disconnect function
export const disconnectDB = async (): Promise<void> => {
    const db = Database.getInstance();
    await db.disconnect();
};

// Export health check
export const checkDBHealth = async () => {
    const db = Database.getInstance();
    return await db.healthCheck();
};