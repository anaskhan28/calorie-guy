require('dotenv').config();
const qrcode = require("qrcode-terminal");
const { Client,RemoteAuth } = require("whatsapp-web.js");
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });


mongoose.connect(process.env.MONGODB_URI).then(() => {
    console.log('mongodb started', process.env.MONGODB_URI)
    const store = new MongoStore({mongoose: mongoose});

    const client = new Client({
        authStrategy: new RemoteAuth({
            store,
            backupSyncIntervalMs: 300000
        })
    });
    console.log(client, 'client')
    client.on("qr", (qr) => {
        console.log('qr started')
        qrcode.generate(qr, { small: true });
    });
    
    client.on("remote_session_saved", () => {
        console.log("Client is ready!");
    });

    client.on("message", async (message) => {
        
        try {
            if (message.from === "status@broadcast") return;
            const contact = await message.getContact();
            const name = contact.pushname || "User";
            const userId = message.from;
        
            let userProfile = userProfiles.get(userId);
            let response;
        
            if (!userProfile && (message.body.toLowerCase() === "hello" || message.body.toLowerCase() === "hi")) {
                response = `Hi 👋🏽 ${name}, Welcome to CalorieGuy,
        
        Lets create your profile in easy 6 Steps ✨,Please share your age as 
        
        /age 21
        
        where 21 is your age as an example
        
        This will help us create your profile and AI will recommend the daily Calorie intake.`;
                userProfiles.set(userId, { step: 0, name, userId });
            } else if (!userProfile || userProfile.step < steps.length) {
                response = handleProfileCreation(userId, name, message.body);
            } else if (message.hasMedia) {
                const media = await message.downloadMedia();
                if (media.mimetype.startsWith("image/")) {
                    const imagePart = fileToGenerativePart(Buffer.from(media.data, "base64"), media.mimetype);
                    response = await generateResponses(name, "Analyze this image and provide calorie and nutritional information for the food shown.", imagePart);
        
                    const nutritionalInfo = extractNutritionalInfo(response);
                    userProfile.lastFood = nutritionalInfo;
                    userProfile.lastFoodName = "food in the image"; // Generic name for the food from the image
                    userProfile.lastFoodDescription = extractDescription(response);
                    userProfile.awaitingConfirmation = true;
        
                    response += `\n\nNutritional Information:
        Calories: ${nutritionalInfo.calories}
        Protein: ${nutritionalInfo.protein}g
        Fat: ${nutritionalInfo.fat}g
        Carbs: ${nutritionalInfo.carbs}g
        Fiber: ${nutritionalInfo.fiber}g
        
        Did you actually eat this? Reply 'yes' if you did.`;
                } else {
                    response = "Sorry, I can only analyze images. Please send a food image or describe the food in text.";
                }
            } else if (userProfile.awaitingConfirmation) {
                if (message.body.toLowerCase() === 'yes') {
                    const { calories, protein, fat, carbs, fiber } = userProfile.lastFood;
                    const updatedIntake = updateDailyIntake(userId, calories, protein, fat, carbs, fiber);
                    const macroTargets = calculateMacroTargets(userProfile.targetCalories);
                    
                    response = `Total Cal: ${updatedIntake.calories}/${userProfile.targetCalories}🔻 Updated records 👍🏽
        Food: ${userProfile.lastFoodName} with ${calories} Calories and macro breakdown:
        Protein: ${protein}g
        Fats: ${fat}g
        Carbs: ${carbs}g
        Fibre: ${fiber}g
        Description: ${userProfile.lastFoodDescription}
        
        🍗Total Protein: ${updatedIntake.protein}/${macroTargets.protein}g🔻
        🥑Total Fat: ${updatedIntake.fat}/${macroTargets.fat}g🔻
        🍞Total Carbs: ${updatedIntake.carbs}/${macroTargets.carbs}g🔻
        🥦Total Fiber: ${updatedIntake.fiber}/${macroTargets.fiber}g🔻
        
        Anything else you want to confess?`;
                } else {
                    response = "Phew, dodged a calorie bullet there. What else can I help you with?";
                }
                userProfile.awaitingConfirmation = false;
            } else {
                response = await generateResponses(name, message.body);
                const nutritionalInfo = extractNutritionalInfo(response);
                userProfile.lastFood = nutritionalInfo;
                userProfile.lastFoodName = message.body;
                userProfile.lastFoodDescription = extractDescription(response);
                userProfile.awaitingConfirmation = true;
                
                response += `\n\nNutritional Information:
        Calories: ${nutritionalInfo.calories}
        Protein: ${nutritionalInfo.protein}g
        Fat: ${nutritionalInfo.fat}g
        Carbs: ${nutritionalInfo.carbs}g
        Fiber: ${nutritionalInfo.fiber}g
        
        Did you actually eat this? Reply 'yes' if you did, you brave soul.`;
            }
        
            await message.reply(response);
            
        } catch (error) {
            console.error("Error processing message:", error);
            await message.reply("Sorry, I encountered an error. Please try again later.");
        }
       

  

})
client.initialize();
})




const userProfiles = new Map();
const steps = ['age', 'height', 'weight', 'goal', 'gender', 'activity'];

function fileToGenerativePart(buffer, mimeType) {
    return {
        inlineData: {
            data: buffer.toString("base64"),
            mimeType,
        },
    };
}

const generateResponses = async (name, message, imagePart = null) => {
    const chat = model.startChat({
        history: [
            {
                role: "user",
                parts: [{ text: "You are CalorieGuy, an AI assistant specializing in Indian cuisine. Provide brief, sarcastic responses with accurate nutritional information for Indian foods. Always include calories, protein, fat, carbs, and fiber in your response. Use this format: 'Calories: X, Protein: Xg, Fat: Xg, Carbs: Xg, Fiber: Xg'. Also provide a brief description of the food." }],
            },
            {
                role: "model",
                parts: [{ text: "Got it. I'm CalorieGuy, ready to sarcastically roast your Indian food choices while providing accurate nutritional info in the specified format." }],
            },
        ],
        generationConfig: {
            temperature: 0.7,
            topK: 1,
            topP: 1,
            maxOutputTokens: 2048,
        },
    });

    let content = [`${name} asked: ${message}`];
    if (imagePart) {
        content.push(imagePart);
    }

    const result = await chat.sendMessage(content);
    return result.response.text();
};

function handleProfileCreation(userId, name, message) {
    let userProfile = userProfiles.get(userId) || { step: 0, name, userId };
    const currentStep = steps[userProfile.step];

    if (message.startsWith(`/${currentStep}`)) {
        const value = message.split(' ')[1];
        userProfile[currentStep] = processInput(currentStep, value);
        userProfile.step++;
        userProfiles.set(userId, userProfile);

        if (userProfile.step < steps.length) {
            return getNextStepPrompt(userProfile.step);
        } else {
            return finalizeProfile(userProfile);
        }
    } else {
        return getStepPrompt(userProfile.step);
    }
}

function processInput(step, value) {
    switch (step) {
        case 'age':
            return Math.max(18, Math.min(100, parseInt(value)));
        case 'height':
            return Math.max(55, Math.min(210, parseInt(value)));
        case 'weight':
            return Math.max(30, Math.min(300, parseFloat(value)));
        case 'goal':
            return ['Lose Weight', 'Maintain Weight', 'Gain Weight'][parseInt(value) - 1];
        case 'gender':
            return value.toLowerCase() === 'male' ? 'Male' : 'Female';
        case 'activity':
            const levels = ['Sedentary', 'Lightly Active', 'Moderately Active', 'Very Active', 'Extra Active'];
            return levels[Math.max(0, Math.min(4, parseInt(value) - 1))];
        default:
            return value;
    }
}

function getStepPrompt(step) {
    const prompts = [
        "Please type '/age' followed by your age (18-100).",
        "Please type '/height' followed by your height in cm (55-210).",
        "Please type '/weight' followed by your weight in kg.",
        "Please type '/goal' followed by a number (1: Lose Weight, 2: Maintain Weight, 3: Gain Weight).",
        "Please type '/gender' followed by your gender (male/female).",
        "Please type '/activity' followed by your activity level (1: Sedentary, 2: Lightly Active, 3: Moderately Active, 4: Very Active, 5: Extra Active)."
    ];
    return prompts[step] + `\nProgress: ${'🟢'.repeat(step)}${'⚪'.repeat(6 - step)}`;
}

function getNextStepPrompt(step) {
    return `Great! ${getStepPrompt(step)}`;
}

function calculateMacroTargets(targetCalories) {
    return {
        protein: Math.round(targetCalories * 0.3 / 4),
        fat: Math.round(targetCalories * 0.3 / 9),
        carbs: Math.round(targetCalories * 0.4 / 4),
        fiber: 25 // Fixed target for fiber
    };
}

function finalizeProfile(userProfile) {
    const { age, height, weight, goal, gender, activity } = userProfile;
    
    let bmr;
    if (gender === 'Male') {
        bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
        bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    }

    const activityMultipliers = {
        'Sedentary': 1.2,
        'Lightly Active': 1.375,
        'Moderately Active': 1.55,
        'Very Active': 1.725,
        'Extra Active': 1.9
    };
    const tdee = bmr * activityMultipliers[activity];

    const goalMultiplier = goal === 'Lose Weight' ? 0.85 : goal === 'Gain Weight' ? 1.15 : 1;
    const targetCalories = Math.round(tdee * goalMultiplier);

    userProfile.targetCalories = targetCalories;
    userProfile.dailyIntake = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 };
    userProfiles.set(userProfile.userId, userProfile);

    const macroTargets = calculateMacroTargets(targetCalories);

    return `Thanks for updating your profile, ${userProfile.name}! 
Your base metabolic rate (BMR) is ${Math.round(bmr)} calories.
Your total daily energy expenditure (TDEE) is ${Math.round(tdee)} calories.
To ${goal}, your target daily calorie intake is ${targetCalories} calories.

Daily Macros Recommendation:
🍗 Protein: ${macroTargets.protein}g
🥑 Fat: ${macroTargets.fat}g
🍞 Carbs: ${macroTargets.carbs}g
🥦 Fiber: ${macroTargets.fiber}g

You can now ask me about the calories in any food item. Just send me the food item name, for example:
- "1 banana"
- "100gm Oats with milk"
- "1 cup of white steamed rice"

Note: For better accuracy, try to share the portion size and the name of the food item.`;
}

function updateDailyIntake(userId, calories, protein, fat, carbs, fiber) {
    const profile = userProfiles.get(userId);
    profile.dailyIntake.calories += calories;
    profile.dailyIntake.protein += protein;
    profile.dailyIntake.fat += fat;
    profile.dailyIntake.carbs += carbs;
    profile.dailyIntake.fiber += fiber;
    userProfiles.set(userId, profile);
    return profile.dailyIntake;
}

function extractNutritionalInfo(response) {
    const nutritionalInfo = {
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        fiber: 0
    };

    const regex = {
        calories: /Calories:\s*(\d+(?:\.\d+)?)/i,
        protein: /Protein:\s*(\d+(?:\.\d+)?)/i,
        fat: /Fat:\s*(\d+(?:\.\d+)?)/i,
        carbs: /Carbs:\s*(\d+(?:\.\d+)?)/i,
        fiber: /Fiber:\s*(\d+(?:\.\d+)?)/i
    };

    for (const [nutrient, pattern] of Object.entries(regex)) {
        const match = response.match(pattern);
        if (match) {
            nutritionalInfo[nutrient] = parseFloat(match[1]);
        }
    }

    if (Object.values(nutritionalInfo).every(val => val === 0)) {
        console.log("Failed to extract nutritional info from:", response);
    }

    return nutritionalInfo;
}
function extractDescription(response) {
    const sentences = response.split('.').map(sentence => sentence.trim()).filter(sentence => sentence.length > 0);

    if (sentences.length >= 2) {
        return sentences[sentences.length - 2] + '.';
    } else if (sentences.length === 1) {
        return sentences[0] + '.';
    } else {
        return "No description available.";
    }
}


function resetDailyIntake(userId) {
    const profile = userProfiles.get(userId);
    if (profile) {
        profile.dailyIntake = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 };
        userProfiles.set(userId, profile);
    }
}

function scheduleResetDailyIntake() {
    const now = new Date();
    const night = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1, // the next day
        0, 0, 0 // at 00:00:00 hours
    );
    const msToMidnight = night.getTime() - now.getTime();

    setTimeout(() => {
        userProfiles.forEach((profile, userId) => {
            resetDailyIntake(userId);
        });
        scheduleResetDailyIntake(); // Schedule the next reset
    }, msToMidnight);
}

// Call this function when the bot starts
scheduleResetDailyIntake();



