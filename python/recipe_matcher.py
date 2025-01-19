import requests
from bs4 import BeautifulSoup
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import re

class RecipeMatcher:
    def __init__(self):
        self.tfidf = TfidfVectorizer(
            stop_words='english',
            ngram_range=(1, 2),  # Consider both unigrams and bigrams
            max_features=5000
        )
    
    def clean_text(self, text):
        """Clean and normalize text."""
        if not text:
            return ""
        # Convert to lowercase and remove special characters
        text = re.sub(r'[^\w\s]', ' ', text.lower())
        # Remove extra whitespace
        text = ' '.join(text.split())
        return text
    
    def extract_structured_data(self, soup):
        """Extract structured recipe data using common recipe page patterns."""
        data = {
            'title': '',
            'ingredients_list': set(),
            'main_content': '',
            'metadata': ''
        }
        
        # Try to find recipe title (looking for common recipe page patterns)
        title_candidates = [
            soup.find('h1'),  # Most common location
            soup.find('meta', {'property': 'og:title'}),  # Open Graph
            soup.find('meta', {'name': 'title'}),
            soup.title
        ]
        
        for candidate in title_candidates:
            if candidate:
                title_text = candidate.get_text() if hasattr(candidate, 'get_text') else candidate.get('content', '')
                if title_text:
                    data['title'] = self.clean_text(title_text)
                    break
        
        # Find ingredients (multiple common patterns)
        ingredients_sections = []
        
        # Look for elements with 'ingredient' in class or id
        ingredients_sections.extend(soup.find_all(class_=re.compile(r'ingredient', re.I)))
        ingredients_sections.extend(soup.find_all(id=re.compile(r'ingredient', re.I)))
        
        # Look for common ingredient list patterns
        ingredients_sections.extend(soup.find_all('ul', class_=re.compile(r'ingredient', re.I)))
        
        for section in ingredients_sections:
            items = section.find_all(['li', 'p', 'span'])
            for item in items:
                cleaned_text = self.clean_text(item.get_text())
                if cleaned_text:
                    data['ingredients_list'].add(cleaned_text)
        
        # Get main content
        main_content = []
        main_sections = soup.find_all(['article', 'main', 'div'], class_=re.compile(r'(content|recipe)', re.I))
        for section in main_sections:
            main_content.append(self.clean_text(section.get_text()))
        data['main_content'] = ' '.join(main_content)
        
        return data
    
    def calculate_match_score(self, page_data, search_data):
        """Calculate a comprehensive match score between the page and search criteria."""
        scores = {
            'title_match': 0.0,
            'ingredients_match': 0.0,
            'content_match': 0.0
        }
        
        # Title matching (30% of total score)
        if search_data.get('title') and page_data['title']:
            search_title = self.clean_text(search_data['title'])
            if search_title in page_data['title']:
                scores['title_match'] = 1.0
            else:
                # Use TF-IDF similarity for partial matches
                title_vectors = self.tfidf.fit_transform([search_title, page_data['title']])
                scores['title_match'] = cosine_similarity(title_vectors[0:1], title_vectors[1:2])[0][0]
        
        # Ingredients matching (40% of total score)
        if search_data.get('ingredients'):
            found_ingredients = 0
            search_ingredients = [self.clean_text(ing) for ing in search_data['ingredients']]
            
            for search_ing in search_ingredients:
                for page_ing in page_data['ingredients_list']:
                    if search_ing in page_ing:
                        found_ingredients += 1
                        break
            
            if search_ingredients:
                scores['ingredients_match'] = found_ingredients / len(search_ingredients)
        
        # Content relevance matching (30% of total score)
        all_search_terms = [
            search_data.get('title', ''),
            *search_data.get('ingredients', [])
        ]
        all_search_terms = ' '.join([self.clean_text(term) for term in all_search_terms if term])
        
        if all_search_terms and page_data['main_content']:
            content_vectors = self.tfidf.fit_transform([all_search_terms, page_data['main_content']])
            scores['content_match'] = cosine_similarity(content_vectors[0:1], content_vectors[1:2])[0][0]
        
        # Calculate weighted final score
        final_score = (
            scores['title_match'] * 0.3 +
            scores['ingredients_match'] * 0.4 +
            scores['content_match'] * 0.3
        )
        
        return final_score, scores
    
    def process_page(self, url, search_data, threshold=0.4):
        """Process a single page and determine if it matches the search criteria."""
        try:
            response = requests.get(url, timeout=10, headers={'User-Agent': 'Recipe-Bot/1.0'})
            if response.status_code != 200:
                return False, 0.0, {}
            
            soup = BeautifulSoup(response.text, 'html.parser')
            page_data = self.extract_structured_data(soup)
            
            final_score, detailed_scores = self.calculate_match_score(page_data, search_data)
            
            matches = final_score >= threshold
            return matches, final_score, detailed_scores
            
        except Exception as e:
            print(f"Error processing {url}: {e}")
            return False, 0.0, {}

    def extract_features(self, soup):
        # Get text content
        text = soup.get_text(separator=' ', strip=True)
        
        # Get title (more weight to title terms)
        title = ""
        if soup.title:
            title = soup.title.string
        
        # Extract ingredients if available
        ingredients = []
        ingredient_section = soup.find_all(['ul', 'div'], class_=re.compile(r'ingredient', re.I))
        for section in ingredient_section:
            ingredients.extend(item.get_text() for item in section.find_all('li'))
        
        # Fit TF-IDF on the content
        tfidf_matrix = self.tfidf.fit_transform([text])
        feature_names = self.tfidf.get_feature_names_out()
        
        # Get top terms
        important_terms = []
        for idx in tfidf_matrix[0].nonzero()[1]:
            important_terms.append(feature_names[idx])
            
        # Add title words and ingredients as additional keywords
        title_words = set(re.findall(r'\w+', title.lower()))
        ingredient_words = set(word.lower() for ing in ingredients 
                             for word in re.findall(r'\w+', ing))
        
        # Combine all keywords
        all_keywords = set(important_terms) | title_words | ingredient_words
        
        return {
            'title': title,
            'keywords': ','.join(all_keywords),
        }
    
    def find_matching_recipes(self, urls, search_data, threshold=0.4):
        """Find all matching recipes from a list of URLs."""
        matches = []
        for url in urls:
            matches_criteria, score, detailed_scores = self.process_page(url, search_data, threshold)
            if matches_criteria:
                matches.append({
                    'url': url,
                    'score': score,
                    'detailed_scores': detailed_scores
                })
        
        # Sort by score in descending order
        matches.sort(key=lambda x: x['score'], reverse=True)
        return matches