// JavaScript script for inserting Ground Handling expenses into Jet Finances database
// This script provides more flexible data processing and better error handling

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl =
  process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'your-anon-key';
const supabase = createClient(supabaseUrl, supabaseKey);

// Original expense data
const expensesData = [
  {
    exp_place: 'OJAM',
    exp_currency: 'USD',
    exp_amount: 4200.0,
    exp_comments: 'AUTOSCAN: Handling-25 JUL24, A6-RTS, OJAM',
  },
  {
    exp_place: 'HEAL',
    exp_currency: 'USD',
    exp_amount: 2714.0,
    exp_comments: 'AUTOSCAN: Handling-19 Jun24, A6-RTS, HEAL-OMDW',
  },
  {
    exp_place: 'OMDW',
    exp_currency: 'USD',
    exp_amount: 200.0,
    exp_comments: 'AUTOSCAN: Landing Permit-17-19 JUL24, A6RTS, OMDW',
  },
  {
    exp_place: 'OMDW',
    exp_currency: 'AED',
    exp_amount: 8605.39,
    exp_comments: 'AUTOSCAN: A6-RTS T#2407-08 Handling',
  },
  {
    exp_place: 'OMDW',
    exp_currency: 'AED',
    exp_amount: 9289.03,
    exp_comments: 'AUTOSCAN: A6-RTS T#2407-08 Handling',
  },
  {
    exp_place: 'LTBA',
    exp_currency: 'USD',
    exp_amount: 2318.91,
    exp_comments: 'AUTOSCAN: Handling-16 Aug24, A6-RTS, LTBA-OMDW',
  },
  {
    exp_place: 'LTFE',
    exp_currency: 'EUR',
    exp_amount: 3520.0,
    exp_comments: 'AUTOSCAN: HANDLING-4 AUG24, A6-RTS, LTFE, OMDW',
  },
  {
    exp_place: 'LTBA',
    exp_currency: 'EUR',
    exp_amount: 140.0,
    exp_comments:
      'AUTOSCAN: Arrival-Departure,14 AUG24, A6-RTS, LTBA, OMDW-OMDW',
  },
  {
    exp_place: 'LGKL',
    exp_currency: 'EUR',
    exp_amount: 2530.0,
    exp_comments: 'AUTOSCAN: HANDLING-24-25 JUL24, A6-RTS, LTBS, LGKL-OJAM',
  },
  {
    exp_place: 'LTFE',
    exp_currency: 'EUR',
    exp_amount: 140.0,
    exp_comments:
      'AUTOSCAN: Arrival-Departure,4 AUG24, A6-RTS, LTFE, OMDW-OMDW',
  },
  {
    exp_place: 'LTBA',
    exp_currency: 'EUR',
    exp_amount: 140.0,
    exp_comments:
      'AUTOSCAN: Arrival-Departure,12 AUG24, A6-RTS, LTBA, OMDB-OMDW',
  },
  {
    exp_place: 'LTBA',
    exp_currency: 'EUR',
    exp_amount: 1705.0,
    exp_comments: 'AUTOSCAN: HANDLING,14 AUG24, A6-RTS, LTBA, OMDW-OMDW',
  },
  {
    exp_place: 'LTBA',
    exp_currency: 'EUR',
    exp_amount: 140.0,
    exp_comments:
      'AUTOSCAN: Arrival-Departure,16 AUG24, A6-RTS, LTBA, OMDW-OMDB',
  },
  {
    exp_place: 'LTBA',
    exp_currency: 'EUR',
    exp_amount: 2350.0,
    exp_comments: 'AUTOSCAN: HANDLING,16 AUG24, A6-RTS, LTBA, OMDW-OMDB',
  },
];

// Helper function to parse date from comments
function parseDateFromComments(comments) {
  const datePatterns = [
    /(\d{1,2})\s+(JUL|AUG|JUN)24/i,
    /(\d{1,2})-(\d{1,2})\s+(JUL|AUG|JUN)24/i,
  ];

  for (const pattern of datePatterns) {
    const match = comments.match(pattern);
    if (match) {
      const monthMap = {
        JAN: '01',
        FEB: '02',
        MAR: '03',
        APR: '04',
        MAY: '05',
        JUN: '06',
        JUL: '07',
        AUG: '08',
        SEP: '09',
        OCT: '10',
        NOV: '11',
        DEC: '12',
      };

      const day = match[1].padStart(2, '0');
      const month = monthMap[match[2].toUpperCase()];
      return `2024-${month}-${day}`;
    }
  }

  return null;
}

// Helper function to extract route information
function extractRouteInfo(comments, place) {
  const routePattern = /([A-Z]{4})-([A-Z]{4})/;
  const match = comments.match(routePattern);

  if (match) {
    const [departure, arrival] = match.slice(1);
    return { departure, arrival };
  }

  // If no route found, try to infer from place
  return { departure: place, arrival: place };
}

// Function to ensure Ground handling expense type exists
async function ensureGroundHandlingType() {
  try {
    // Check if Ground handling type exists
    const { data: existingType, error: checkError } = await supabase
      .from('expense_types')
      .select('id')
      .eq('name', 'Ground handling')
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    if (!existingType) {
      // Create Ground handling type
      const { data: newType, error: createError } = await supabase
        .from('expense_types')
        .insert([
          {
            name: 'Ground handling',
            description:
              'Ground handling services including arrival and departure services',
          },
        ])
        .select()
        .single();

      if (createError) throw createError;
      console.log('✅ Created Ground handling expense type');
      return newType.id;
    }

    console.log('✅ Ground handling expense type already exists');
    return existingType.id;
  } catch (error) {
    console.error('❌ Error ensuring Ground handling type:', error);
    throw error;
  }
}

// Function to ensure subtypes exist
async function ensureSubtypes(typeId) {
  const subtypes = [
    { name: 'arrival', description: 'Arrival ground handling services' },
    { name: 'departure', description: 'Departure ground handling services' },
    { name: 'Landing Permit', description: 'Landing permit fees' },
  ];

  for (const subtype of subtypes) {
    try {
      const { data: existingSubtype, error: checkError } = await supabase
        .from('expense_subtypes')
        .select('id')
        .eq('expense_type_id', typeId)
        .eq('name', subtype.name)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
      }

      if (!existingSubtype) {
        const { error: createError } = await supabase
          .from('expense_subtypes')
          .insert([
            {
              expense_type_id: typeId,
              name: subtype.name,
              description: subtype.description,
            },
          ]);

        if (createError) throw createError;
        console.log(`✅ Created ${subtype.name} subtype`);
      } else {
        console.log(`✅ ${subtype.name} subtype already exists`);
      }
    } catch (error) {
      console.error(`❌ Error ensuring ${subtype.name} subtype:`, error);
      throw error;
    }
  }
}

// Function to find matching flights
async function findMatchingFlights(place, date) {
  try {
    const { data: flights, error } = await supabase
      .from('flights')
      .select('*')
      .or(`flt_dep.eq.${place},flt_arr.eq.${place}`)
      .eq('flt_date', date);

    if (error) throw error;
    return flights || [];
  } catch (error) {
    console.error(`❌ Error finding flights for ${place} on ${date}:`, error);
    return [];
  }
}

// Function to insert expense
async function insertExpense(expenseData) {
  try {
    const { data, error } = await supabase
      .from('expenses')
      .insert([expenseData])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('❌ Error inserting expense:', error);
    throw error;
  }
}

// Main function to process and insert expenses
async function processAndInsertExpenses() {
  try {
    console.log('🚀 Starting Ground Handling expenses insertion...');

    // Ensure expense type and subtypes exist
    const typeId = await ensureGroundHandlingType();
    await ensureSubtypes(typeId);

    let successCount = 0;
    let errorCount = 0;

    for (const expense of expensesData) {
      try {
        const date = parseDateFromComments(expense.exp_comments);
        const routeInfo = extractRouteInfo(
          expense.exp_comments,
          expense.exp_place
        );

        console.log(
          `\n📋 Processing: ${expense.exp_place} - ${expense.exp_comments}`
        );

        // Find matching flights
        const flights = date
          ? await findMatchingFlights(expense.exp_place, date)
          : [];

        if (flights.length === 0) {
          console.log(
            `⚠️  No flights found for ${expense.exp_place} on ${date || 'unknown date'}`
          );
        } else {
          console.log(`✈️  Found ${flights.length} matching flight(s)`);
        }

        // Determine if this is a Landing Permit (should not be split)
        const isLandingPermit = expense.exp_comments.includes('Landing Permit');

        if (isLandingPermit) {
          // Insert single Landing Permit expense
          const expenseData = {
            exp_type: 'Ground handling',
            exp_subtype: 'Landing Permit',
            exp_place: expense.exp_place,
            exp_currency: expense.exp_currency,
            exp_amount: expense.exp_amount,
            exp_comments: expense.exp_comments,
            exp_flight: flights.length > 0 ? flights[0].id : null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          await insertExpense(expenseData);
          console.log(
            `✅ Inserted Landing Permit expense: ${expense.exp_amount} ${expense.exp_currency}`
          );
          successCount++;
        } else {
          // Split handling expenses into arrival and departure
          const halfAmount = Math.round((expense.exp_amount / 2) * 100) / 100;

          // Insert arrival expense
          const arrivalData = {
            exp_type: 'Ground handling',
            exp_subtype: 'arrival',
            exp_place: expense.exp_place,
            exp_currency: expense.exp_currency,
            exp_amount: halfAmount,
            exp_comments: `${expense.exp_comments} - Arrival`,
            exp_flight: flights.length > 0 ? flights[0].id : null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          await insertExpense(arrivalData);
          console.log(
            `✅ Inserted arrival expense: ${halfAmount} ${expense.exp_currency}`
          );

          // Insert departure expense
          const departureData = {
            exp_type: 'Ground handling',
            exp_subtype: 'departure',
            exp_place: expense.exp_place,
            exp_currency: expense.exp_currency,
            exp_amount: halfAmount,
            exp_comments: `${expense.exp_comments} - Departure`,
            exp_flight: flights.length > 0 ? flights[0].id : null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          await insertExpense(departureData);
          console.log(
            `✅ Inserted departure expense: ${halfAmount} ${expense.exp_currency}`
          );

          successCount += 2;
        }
      } catch (error) {
        console.error(
          `❌ Error processing expense for ${expense.exp_place}:`,
          error
        );
        errorCount++;
      }
    }

    console.log(`\n🎉 Processing complete!`);
    console.log(`✅ Successfully inserted: ${successCount} expenses`);
    console.log(`❌ Errors: ${errorCount} expenses`);

    // Show summary
    const { data: summary, error: summaryError } = await supabase
      .from('expenses')
      .select('exp_subtype, exp_currency, exp_amount')
      .eq('exp_type', 'Ground handling');

    if (!summaryError && summary) {
      console.log('\n📊 Summary of inserted Ground Handling expenses:');
      const grouped = summary.reduce((acc, expense) => {
        const key = `${expense.exp_subtype} (${expense.exp_currency})`;
        if (!acc[key]) {
          acc[key] = { count: 0, total: 0 };
        }
        acc[key].count++;
        acc[key].total += expense.exp_amount;
        return acc;
      }, {});

      Object.entries(grouped).forEach(([key, data]) => {
        console.log(
          `  ${key}: ${data.count} records, ${data.total.toFixed(2)} total`
        );
      });
    }
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  processAndInsertExpenses()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = {
  processAndInsertExpenses,
  parseDateFromComments,
  extractRouteInfo,
};
