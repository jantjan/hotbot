const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Bot configuration
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Store hotpot mentions and active polls
const hotpotMentions = new Map(); // channelId -> { count, users: Set, messageId }
const activePolls = new Map(); // messageId -> poll data

// Configuration
const MENTION_THRESHOLD = 2; // Number of unique mentions needed
const REACTION_THRESHOLD = 1; // Number of reactions needed to trigger poll
const HOTPOT_KEYWORDS = ['hotpot', 'hot pot', '火锅'];

// Get upcoming Fridays
function getUpcomingFridays(count = 4) {
    const fridays = [];
    const today = new Date();
    let current = new Date(today);
    
    // Find next Friday
    const daysUntilFriday = (5 - current.getDay() + 7) % 7;
    if (daysUntilFriday === 0 && current.getHours() >= 18) {
        // If it's Friday evening, start from next Friday
        current.setDate(current.getDate() + 7);
    } else {
        current.setDate(current.getDate() + daysUntilFriday);
    }
    
    for (let i = 0; i < count; i++) {
        fridays.push(new Date(current));
        current.setDate(current.getDate() + 7);
    }
    
    return fridays;
}

// Format date for display
function formatDate(date) {
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// Check if message contains hotpot keywords
function containsHotpotKeyword(message) {
    const content = message.toLowerCase();
    return HOTPOT_KEYWORDS.some(keyword => content.includes(keyword));
}

client.on('ready', () => {
    console.log(`🔥 ${client.user.tag} is ready to organize hotpot meetups!`);
});

client.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;
    
    // Check for hotpot mentions
    if (containsHotpotKeyword(message.content)) {
        const channelId = message.channel.id;
        const userId = message.author.id;
        
        // Initialize or get existing mention data
        if (!hotpotMentions.has(channelId)) {
            hotpotMentions.set(channelId, {
                count: 0,
                users: new Set(),
                messageId: null,
                timestamp: Date.now()
            });
        }
        
        const mentionData = hotpotMentions.get(channelId);
        
        // Reset if it's been more than 30 minutes since last activity
        if (Date.now() - mentionData.timestamp > 30 * 60 * 1000) {
            mentionData.count = 0;
            mentionData.users.clear();
            mentionData.messageId = null;
        }
        
        // Add user mention if they haven't mentioned yet
        if (!mentionData.users.has(userId)) {
            mentionData.users.add(userId);
            mentionData.count++;
            mentionData.timestamp = Date.now();
            
            console.log(`Hotpot mention #${mentionData.count} in ${message.channel.name} by ${message.author.username}`);
            
            // Send interest message when threshold is reached
            if (mentionData.count >= MENTION_THRESHOLD && !mentionData.messageId) {
                const embed = new EmbedBuilder()
                    .setColor('#FF6B35')
                    .setTitle('🍲 Hotpot Interest Detected!')
                    .setDescription(`I see ${mentionData.count} people are interested in hotpot! React with 🔥 if you want to join a hotpot meetup!`)
                    .addFields({
                        name: 'Next Steps',
                        value: `Need ${REACTION_THRESHOLD} reactions to create a scheduling poll for upcoming Fridays!`
                    })
                    .setFooter({ text: 'HotBot • React within 10 minutes!' })
                    .setTimestamp();
                
                try {
                    const sentMessage = await message.channel.send({ embeds: [embed] });
                    await sentMessage.react('🔥');
                    mentionData.messageId = sentMessage.id;
                    
                    // Auto-cleanup after 10 minutes
                    setTimeout(() => {
                        if (hotpotMentions.has(channelId)) {
                            const data = hotpotMentions.get(channelId);
                            if (data.messageId === sentMessage.id) {
                                hotpotMentions.delete(channelId);
                                console.log(`Cleaned up expired hotpot interest in ${message.channel.name}`);
                            }
                        }
                    }, 10 * 60 * 1000);
                    
                } catch (error) {
                    console.error('Error sending interest message:', error);
                }
            }
        }
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    // Ignore bot reactions
    if (user.bot) return;
    
    // Handle partial reactions
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Error fetching reaction:', error);
            return;
        }
    }
    
    const messageId = reaction.message.id;
    const channelId = reaction.message.channel.id;
    
    // Check if this is a reaction to our interest message
    if (hotpotMentions.has(channelId)) {
        const mentionData = hotpotMentions.get(channelId);
        
        if (mentionData.messageId === messageId && reaction.emoji.name === '🔥') {
            const reactionCount = reaction.count - 1; // Subtract bot's own reaction
            
            console.log(`Hotpot reaction count: ${reactionCount}/${REACTION_THRESHOLD}`);
            
            // Create poll when threshold is reached
            if (reactionCount >= REACTION_THRESHOLD && !activePolls.has(messageId)) {
                const fridays = getUpcomingFridays();
                
                const embed = new EmbedBuilder()
                    .setColor('#4CAF50')
                    .setTitle('🗓️ Hotpot Meetup Poll')
                    .setDescription('Great! Enough people are interested. Please vote for your preferred Friday:')
                    .setFooter({ text: 'HotBot • Vote ends in 24 hours' })
                    .setTimestamp();
                
                // Add Friday options as fields
                fridays.forEach((friday, index) => {
                    embed.addFields({
                        name: `Option ${index + 1}`,
                        value: formatDate(friday),
                        inline: true
                    });
                });
                
                try {
                    const pollMessage = await reaction.message.channel.send({ embeds: [embed] });
                    
                    // Add number reactions for voting
                    const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
                    for (let i = 0; i < fridays.length; i++) {
                        await pollMessage.react(numberEmojis[i]);
                    }
                    
                    // Store poll data
                    activePolls.set(messageId, {
                        pollMessageId: pollMessage.id,
                        channelId: channelId,
                        fridays: fridays,
                        endTime: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
                    });
                    
                    // Clean up mention data
                    hotpotMentions.delete(channelId);
                    
                    // Schedule poll end
                    setTimeout(async () => {
                        await endPoll(messageId);
                    }, 24 * 60 * 60 * 1000);
                    
                    console.log(`Created hotpot poll in ${reaction.message.channel.name}`);
                    
                } catch (error) {
                    console.error('Error creating poll:', error);
                }
            }
        }
    }
});

// End poll and announce results
async function endPoll(originalMessageId) {
    if (!activePolls.has(originalMessageId)) return;
    
    const pollData = activePolls.get(originalMessageId);
    
    try {
        const channel = await client.channels.fetch(pollData.channelId);
        const pollMessage = await channel.messages.fetch(pollData.pollMessageId);
        
        const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
        const results = [];
        
        // Count votes
        for (let i = 0; i < pollData.fridays.length; i++) {
            const reaction = pollMessage.reactions.cache.get(numberEmojis[i]);
            const voteCount = reaction ? reaction.count - 1 : 0; // Subtract bot's reaction
            
            results.push({
                date: pollData.fridays[i],
                votes: voteCount,
                index: i
            });
        }
        
        // Sort by votes (descending)
        results.sort((a, b) => b.votes - a.votes);
        
        const winningOption = results[0];
        
        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('🎉 Hotpot Poll Results!')
            .setDescription(results[0].votes > 0 
                ? `**Winner:** ${formatDate(winningOption.date)} with ${winningOption.votes} votes!`
                : 'No votes were cast for any option.')
            .setFooter({ text: 'HotBot • Time to plan your hotpot meetup!' })
            .setTimestamp();
        
        // Add all results
        let resultText = '';
        results.forEach((result, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📍';
            resultText += `${medal} ${formatDate(result.date)}: ${result.votes} votes\n`;
        });
        
        if (resultText) {
            embed.addFields({
                name: 'All Results',
                value: resultText
            });
        }
        
        if (results[0].votes > 0) {
            embed.addFields({
                name: 'Next Steps',
                value: 'Coordinate the details in this channel. Enjoy your hotpot! 🍲'
            });
        }
        
        await channel.send({ embeds: [embed] });
        
        // Clean up
        activePolls.delete(originalMessageId);
        
    } catch (error) {
        console.error('Error ending poll:', error);
        activePolls.delete(originalMessageId);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down HotBot...');
    client.destroy();
    process.exit(0);
});

// Load environment variables
require('dotenv').config();

// Login with your bot token
client.login(process.env.DISCORD_TOKEN);