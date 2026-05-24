import * as cheerio from 'cheerio';

export async function getTrainAllocation(uid: string, date: string): Promise<string[]> {
  const url = `https://www.realtimetrains.co.uk/service/gb-nr:${uid}/${date}/detailed`;
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  
  // LOG THIS:
  if (!response.ok) {
    const errorText = await response.text(); 
    console.error(`RTT Failed: ${response.status} ${response.statusText}`);
    console.error(`Response Body Preview: ${errorText.substring(0, 200)}`);
    throw new Error(`Failed to fetch data from Realtime Trains: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const allocationText = $('.op').text();
  if (!allocationText) return [];

  const vehicles = allocationText.split('+').map(v => v.trim());
  return vehicles.map(v => v.split(' (')[0].trim());
}