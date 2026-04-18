import uuid
from datetime import datetime, timezone, timedelta
from flask import Flask, jsonify, request, render_template, abort
from supabase import create_client, Client
import os
from dotenv import load_dotenv
import cloudinary
import cloudinary.uploader

load_dotenv()

cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True
)

app = Flask(__name__)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 86400  # 24 hours

@app.after_request
def add_cache_headers(response):
    # Only cache successful GET requests for HTML pages
    if request.method == 'GET' and response.status_code == 200:
        if response.content_type.startswith('text/html'):
            # Do not cache dynamic HTML (specifically PDP and carts) locally or rigidly
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        elif request.path.startswith('/static/'):
            # Cache static assets intensely
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        elif request.path == '/api/products' or request.path.startswith('/api/products/'):
            # Cache products API
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    return response


app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret')

# Expose Supabase config to Jinja2 templates
url: str = os.getenv("SUPABASE_URL", "")
key: str = os.getenv("SUPABASE_KEY", "")
app.config['SUPABASE_URL'] = url
app.config['SUPABASE_KEY'] = key

# Initialize Supabase
service_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
try:
    supabase: Client = create_client(url, key)
    supabase_admin: Client = create_client(url, service_key) if service_key else supabase
except Exception as e:
    print(f"Failed to initialize Supabase client: {e}")
    supabase = None
    supabase_admin = None


# ---------------------
# Auth Helpers
# ---------------------

def get_user_from_token(req):
    """Extracts JWT token from Authorization header and returns user data if valid."""
    auth_header = req.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split(" ")[1]
    try:
        res = supabase.auth.get_user(token)
        return res.user
    except Exception as e:
        print(f"Auth error: {e}")
        return None


def is_admin(user_id):
    """Checks if a user has the admin role."""
    try:
        response = supabase_admin.table("profiles").select("role").eq("id", user_id).execute()
        if response.data and len(response.data) > 0:
            return response.data[0].get("role") == "admin"
        return False
    except Exception as e:
        print(f"Admin check error: {e}")
        return False


# ---------------------
# Storefront Routes
# ---------------------

@app.route("/favicon.ico")
def favicon():
    return "", 204

@app.route("/orders")
def orders_page():
    return render_template("orders.html")

@app.route("/")
def index():
    return render_template("home.html")

@app.route("/login")
def login_page():
    return render_template("login.html")

@app.route("/forgot-password")
def forgot_password_page():
    return render_template("forgot_password.html")

@app.route("/product/<product_id>")
def pdp(product_id):
    """Server-side rendered Product Detail Page for SEO + instant load."""
    try:
        response = supabase_admin.table("products").select("*").eq("id", product_id).single().execute()
        product = response.data
        if not product:
            abort(404)
        return render_template("pdp.html", product=product)
    except Exception as e:
        print(f"PDP error: {e}")
        abort(404)


# ---------------------
# Admin Routes
# ---------------------

@app.route("/admin")
def admin():
    return render_template("admin.html")


@app.route("/checkout")
def checkout_page():
    return render_template("checkout.html")


# ---------------------
# Helper: Cart expiration
# ---------------------
def cleanup_expired_holds():
    try:
        now_str = datetime.now(timezone.utc).isoformat()
        # Atomically delete expired holds and return deleted rows to avoid race conditions
        expired_res = supabase_admin.table("cart_items").delete().not_.is_("expires_at", "null").lt("expires_at", now_str).execute()
        if not expired_res.data:
            return

        # Restore stock for each deleted item
        for item in expired_res.data:
            # Get current stock
            prod_res = supabase_admin.table("products").select("stock").eq("id", item['product_id']).execute()
            if prod_res.data:
                current_stock = prod_res.data[0].get("stock", 0)
                new_stock = current_stock + item['quantity']
                supabase_admin.table("products").update({"stock": new_stock}).eq("id", item['product_id']).execute()

    except Exception as e:
        print("Cleanup error:", e)

# ---------------------
# Public API — Products
# ---------------------

@app.route("/api/products", methods=["GET"])
def get_products():
    cleanup_expired_holds()
    try:
        res = supabase_admin.table("products").select("*").eq("is_active", True).execute()
        response = jsonify(res.data)
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response, 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500


@app.route("/api/products/<product_id>", methods=["GET"])
def get_product(product_id):
    try:
        res = supabase_admin.table("products").select("*").eq("id", product_id).execute()
        if not res.data:
            return jsonify({"error": "Product not found"}), 404
        response = jsonify(res.data[0])
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response, 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500


# ---------------------
# Protected API — Cart
# ---------------------

@app.route("/api/cart", methods=["GET"])
def get_cart():
    cleanup_expired_holds()
    session_id = request.headers.get("X-Guest-Session-ID")
    if not session_id:
        return jsonify({"error": "Unauthorized"}), 401
    try:
        res = supabase_admin.table("cart_items").select("*, products(*)").eq("session_id", session_id).execute()
        return jsonify(res.data), 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500


@app.route("/api/cart", methods=["POST"])
def add_to_cart():
    session_id = request.headers.get("X-Guest-Session-ID")
    if not session_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    product_id = data.get("product_id")
    quantity = data.get("quantity", 1)
    size = data.get("size")

    if not product_id:
        return jsonify({"error": "Product ID is required"}), 400

    try:
        cleanup_expired_holds()

        # Check product stock
        prod_res = supabase_admin.table("products").select("stock").eq("id", product_id).execute()
        if not prod_res.data:
            return jsonify({"error": "Product not found"}), 404
        max_stock = prod_res.data[0].get("stock", 0)

        # Check if already exists in cart (matching product and size)
        query = supabase_admin.table("cart_items").select("*").eq("session_id", session_id).eq("product_id", product_id)
        existing = query.execute()
        
        target_item = None
        for item in existing.data:
            if item.get("size") == size:
                target_item = item
                break

        if quantity > max_stock:
            return jsonify({"error": f"Only {max_stock} items available"}), 400

        # Create 15-minute expiration timestamp
        expires_at_val = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
        
        # Decrement stock by exactly `quantity` (since they are adding this many more)
        new_stock = max(0, max_stock - quantity)
        supabase_admin.table("products").update({"stock": new_stock}).eq("id", product_id).execute()

        if target_item:
            new_qty = target_item['quantity'] + quantity
            res = supabase_admin.table("cart_items").update({
                "quantity": new_qty,
                "expires_at": expires_at_val
            }).eq("id", target_item['id']).execute()
            return jsonify(res.data[0]), 200
        else:
            payload = {
                "session_id": session_id,
                "product_id": product_id,
                "quantity": quantity,
                "expires_at": expires_at_val
            }
            if size:
                payload["size"] = size
            
            res = supabase_admin.table("cart_items").insert(payload).execute()
            return jsonify(res.data[0]), 201

    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500


@app.route("/api/cart/<cart_item_id>", methods=["PATCH"])
def update_cart_item(cart_item_id):
    """Update quantity of a cart item."""
    session_id = request.headers.get("X-Guest-Session-ID")
    if not session_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    quantity = data.get("quantity")

    if quantity is None or quantity < 1:
        return jsonify({"error": "Quantity must be at least 1"}), 400

    try:
        cleanup_expired_holds()
        # We need the old quantity from cart_items and current stock from products
        cart_res = supabase_admin.table("cart_items").select("quantity, product_id, products!inner(stock)").eq("id", cart_item_id).eq("session_id", session_id).execute()
        
        if not cart_res.data:
            return jsonify({"error": "Item not found in cart"}), 404
            
        old_qty = cart_res.data[0].get('quantity', 0)
        product_id = cart_res.data[0]['product_id']
        current_stock = cart_res.data[0]['products'].get('stock', 0)
        
        diff = quantity - old_qty
        
        if diff > 0 and diff > current_stock:
            return jsonify({"error": f"Only {current_stock} more items available"}), 400

        new_stock = max(0, current_stock - diff)
        supabase_admin.table("products").update({"stock": new_stock}).eq("id", product_id).execute()

        expires_at_val = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()

        res = supabase_admin.table("cart_items").update({
            "quantity": quantity,
            "expires_at": expires_at_val
        }).eq("id", cart_item_id).eq("session_id", session_id).execute()

        if not res.data:
            return jsonify({"error": "Cart item not found"}), 404
        return jsonify(res.data[0]), 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500


@app.route("/api/cart/<cart_item_id>", methods=["DELETE"])
def remove_from_cart(cart_item_id):
    cleanup_expired_holds()
    session_id = request.headers.get("X-Guest-Session-ID")
    if not session_id:
        return jsonify({"error": "Unauthorized"}), 401
    try:
                # Atomically delete and get the deleted item
        del_res = supabase_admin.table("cart_items").delete().eq("id", cart_item_id).eq("session_id", session_id).execute()
        if del_res.data:
            qty = del_res.data[0].get('quantity', 0)
            product_id = del_res.data[0]['product_id']
            # Put stock back securely
            prod_res = supabase_admin.table("products").select("stock").eq("id", product_id).execute()
            if prod_res.data:
                current_stock = prod_res.data[0].get('stock', 0)
                supabase_admin.table("products").update({"stock": current_stock + qty}).eq("id", product_id).execute()
        
        return jsonify({"message": "Item removed from cart"}), 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500

# ---------------------
# Checkout API
# ---------------------

@app.route("/api/checkout/validate-coupon", methods=["POST"])
def validate_coupon():
    session_id = request.headers.get("X-Guest-Session-ID")
    if not session_id:
        return jsonify({"error": "Unauthorized"}), 401
    
    code = request.json.get("code")
    if not code:
        return jsonify({"error": "Missing coupon code"}), 400
        
    try:
        res = supabase_admin.table("coupons").select("*").eq("code", code).eq("is_active", True).execute()
        if not res.data:
            return jsonify({"error": "Invalid or inactive coupon"}), 400
        return jsonify(res.data[0]), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/checkout", methods=["POST"])
def place_order():
    cleanup_expired_holds()
    session_id = request.headers.get("X-Guest-Session-ID")
    if not session_id:
        return jsonify({"error": "Unauthorized"}), 401
        
    data = request.json or {}
    shipping_address = data.get("shipping_address")
    contact_number = data.get("contact_number")
    province = data.get("province")
    district = data.get("district")
    city = data.get("city")
    coupon_code = data.get("coupon_code")
    payment_method = data.get("payment_method", "cash_on_delivery")
    payment_receipt_url = data.get("payment_receipt_url")
    alternate_contact_number = data.get("alternate_contact_number")
    custom_message = data.get("custom_message")
    
    if not shipping_address:
        return jsonify({"error": "Missing shipping address"}), 400
        
    if not contact_number or not contact_number.isdigit() or len(contact_number) != 10:
        return jsonify({"error": "Please input a valid 10-digit phone number"}), 400
        
    if alternate_contact_number and (not alternate_contact_number.isdigit() or len(alternate_contact_number) != 10):
        return jsonify({"error": "Please input a valid 10-digit alternate phone number"}), 400
        
    try:
        # Get cart
        cart_res = supabase_admin.table("cart_items").select("*, products(*)").eq("session_id", session_id).execute()
        if not cart_res.data:
            return jsonify({"error": "Cart is empty"}), 400
            
        cart_items = cart_res.data
        total_amount = sum([item['quantity'] * float(item['products']['price']) for item in cart_items])
        
        # apply discount
        discount_percentage = 0
        if coupon_code:
            coupon_res = supabase_admin.table("coupons").select("*").eq("code", coupon_code).eq("is_active", True).execute()
            if coupon_res.data:
                discount_percentage = coupon_res.data[0]['discount_percentage']
                
        if discount_percentage > 0:
            total_amount = total_amount * (100 - discount_percentage) / 100.0
            
        order_number = f"ORD-{str(uuid.uuid4())[:8].upper()}"
        
        order_data = {
            "session_id": session_id,
            "total_amount": total_amount,
            "order_number": order_number,
            "shipping_address": shipping_address,
            "contact_number": contact_number,
            "alternate_contact_number": alternate_contact_number,
            "custom_message": custom_message,
            "province": province,
            "district": district,
            "city": city,
            "payment_method": payment_method,
            "payment_receipt_url": payment_receipt_url
        }
        
        order_res = supabase_admin.table("orders").insert(order_data).execute()
        if not order_res.data:
            raise Exception("Failed to save order")
            
        order = order_res.data[0]
        
        # Save order items
        order_items_data = []
        for item in cart_items:
            order_items_data.append({
                "order_id": order['id'],
                "product_id": item['product_id'],
                "size": item.get('size'),
                "quantity": item['quantity'],
                "price_at_time": item['products']['price']
            })
            
        supabase_admin.table("order_items").insert(order_items_data).execute()
        
        # Remove cart items
        supabase_admin.table("cart_items").delete().eq("session_id", session_id).execute()
        
        return jsonify({"message": "Order placed successfully", "order_id": order_number}), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/orders", methods=["GET"])
def get_user_orders():
    session_id = request.headers.get("X-Guest-Session-ID")
    if not session_id:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        # Fetch the user's orders and include order_items & their products
        res = supabase_admin.table("orders").select("*, order_items(*, products(*))").eq("session_id", session_id).order('created_at', desc=True).execute()
        return jsonify(res.data), 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred while loading orders: {str(e)}"}), 500

@app.route("/api/orders/<order_id>/cancel", methods=["POST"])
def cancel_user_order(order_id):
    session_id = request.headers.get("X-Guest-Session-ID")
    if not session_id:
        return jsonify({"error": "Unauthorized"}), 401
    
    try:
        # Verify the order belongs to the user
        order_res = supabase_admin.table("orders").select("*").eq("id", order_id).eq("session_id", session_id).execute()
        if not order_res.data:
            return jsonify({"error": "Order not found"}), 404
        
        order = order_res.data[0]
        if order["status"] != "pending":
            return jsonify({"error": "Only pending orders can be cancelled"}), 400
            
        update_res = supabase_admin.table("orders").update({"status": "cancelled"}).eq("id", order_id).execute()
        return jsonify(update_res.data[0]), 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred while cancelling order: {str(e)}"}), 500

# ---------------------
# Admin API — Protected & Role Restricted
# ---------------------

@app.route("/api/admin/stats", methods=["GET"])
def admin_stats():
    """Dashboard statistics: total sales, pending orders, low stock."""
    user = get_user_from_token(request)
    if not user or not is_admin(user.id):
        return jsonify({"error": "Forbidden"}), 403

    try:
        # Total sales (sum of all orders)
        orders_res = supabase_admin.table("orders").select("total_amount, status").execute()
        orders = orders_res.data or []

        total_sales = sum(float(o['total_amount']) for o in orders if o['status'] != 'cancelled')
        pending_orders = len([o for o in orders if o['status'] == 'pending'])
        total_orders = len(orders)

        # Low stock products (stock <= 5)
        low_stock_res = supabase_admin.table("products").select("id").lte("stock", 5).eq("is_active", True).execute()
        low_stock_count = len(low_stock_res.data) if low_stock_res.data else 0

        # Total products
        products_res = supabase_admin.table("products").select("id").eq("is_active", True).execute()
        total_products = len(products_res.data) if products_res.data else 0

        return jsonify({
            "total_sales": total_sales,
            "total_orders": total_orders,
            "pending_orders": pending_orders,
            "low_stock_count": low_stock_count,
            "total_products": total_products
        }), 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500


@app.route("/api/admin/products", methods=["GET"])
def admin_get_products():
    """Get ALL products for admin (including inactive)."""
    user = get_user_from_token(request)
    if not user or not is_admin(user.id):
        return jsonify({"error": "Forbidden"}), 403
    try:
        res = supabase_admin.table("products").select("*").order("created_at", desc=True).execute()
        return jsonify(res.data), 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500


@app.route("/api/admin/products", methods=["POST"])
def admin_create_product():
    user = get_user_from_token(request)
    if not user or not is_admin(user.id):
        return jsonify({"error": "Forbidden. Admin access required."}), 403

    data = request.json
    try:
        res = supabase_admin.table("products").insert(data).execute()
        return jsonify(res.data[0]), 201
    except Exception as e:
        error_str = str(e)
        if "PGRST204" in error_str:
            return jsonify({"error": "Schema cache is stale or migration not applied. Please run the migration.sql in Supabase, then go to Supabase Dashboard -> Project Settings -> API -> Reload schema cache."}), 500
        return jsonify({"error": f"An unknown error occurred while creating the product: {error_str}"}), 500


@app.route("/api/admin/products/<product_id>", methods=["PUT"])
def admin_update_product(product_id):
    user = get_user_from_token(request)
    if not user or not is_admin(user.id):
        return jsonify({"error": "Forbidden"}), 403

    data = request.json
    try:
        res = supabase_admin.table("products").update(data).eq("id", product_id).execute()
        return jsonify(res.data[0]), 200
    except Exception as e:
        error_str = str(e)
        if "PGRST204" in error_str:
            return jsonify({"error": "Schema cache is stale or migration not applied. Please run the migration.sql in Supabase, then go to Supabase Dashboard -> Project Settings -> API -> Reload schema cache."}), 500
        return jsonify({"error": f"An unknown error occurred: {error_str}"}), 500


@app.route("/api/admin/products/<product_id>", methods=["DELETE"])
def admin_delete_product(product_id):
    user = get_user_from_token(request)
    if not user or not is_admin(user.id):
        return jsonify({"error": "Forbidden"}), 403

    try:
        supabase_admin.table("products").delete().eq("id", product_id).execute()
        return jsonify({"message": "Product deleted"}), 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500


@app.route("/api/admin/orders", methods=["GET"])
def admin_get_orders():
    user = get_user_from_token(request)
    if not user or not is_admin(user.id):
        return jsonify({"error": "Forbidden"}), 403

    try:
        # Also include user details like phone and address if they exist
        res = supabase_admin.table("orders").select("*").order('created_at', desc=True).limit(100).execute()
        return jsonify(res.data), 200
    except Exception as e:
        error_str = str(e)
        if "PGRST200" in error_str:
            return jsonify({"error": "No orders found, or missing relationship between 'orders' and 'profiles' in the database schema. If deploying, please ensure 'orders.user_id' references 'public.profiles(id)'."}), 500
        return jsonify({"error": f"An unknown error occurred while loading orders: {error_str}"}), 500


@app.route("/api/admin/orders/<order_id>", methods=["PUT"])
def admin_update_order(order_id):
    user = get_user_from_token(request)
    if not user or not is_admin(user.id):
        return jsonify({"error": "Forbidden"}), 403

    data = request.json
    status = data.get("status")

    if not status:
        return jsonify({"error": "Status is required"}), 400

    try:
        old_order_res = supabase_admin.table("orders").select("status").eq("id", order_id).execute()
        old_order = old_order_res.data[0] if old_order_res.data else None

        res = supabase_admin.table("orders").update({"status": status}).eq("id", order_id).execute()
        
        if old_order and old_order['status'] != 'cancelled' and status == 'cancelled':
            order_items_res = supabase_admin.table("order_items").select("*").eq("order_id", order_id).execute()
            for item in order_items_res.data:
                product_id = item['product_id']
                qty = item['quantity']
                prod_res = supabase_admin.table("products").select("stock").eq("id", product_id).execute()
                if prod_res.data:
                    current_stock = prod_res.data[0]['stock']
                    new_stock = current_stock + qty
                    supabase_admin.table("products").update({"stock": new_stock}).eq("id", product_id).execute()

        return jsonify(res.data[0]), 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500


@app.route("/api/admin/orders/<order_id>/items", methods=["GET"])
def admin_get_order_items(order_id):
    user = get_user_from_token(request)
    if not user or not is_admin(user.id):
        return jsonify({"error": "Forbidden"}), 403

    try:
        res = supabase_admin.table("order_items").select("*, products(title, image_url)").eq("order_id", order_id).execute()
        return jsonify(res.data), 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500


@app.route("/api/admin/coupons", methods=["GET"])
def admin_get_coupons():
    user = get_user_from_token(request)
    if not user or not is_admin(user.id):
        return jsonify({"error": "Forbidden"}), 403

    try:
        res = supabase_admin.table("coupons").select("*").order("created_at", desc=True).execute()
        return jsonify(res.data), 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500

@app.route("/api/admin/coupons", methods=["POST"])
def admin_create_coupon():
    user = get_user_from_token(request)
    if not user or not is_admin(user.id):
        return jsonify({"error": "Forbidden"}), 403

    data = request.json
    try:
        res = supabase_admin.table("coupons").insert(data).execute()
        return jsonify(res.data[0]), 201
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500

@app.route("/api/admin/coupons/<coupon_id>", methods=["DELETE"])
def admin_delete_coupon(coupon_id):
    user = get_user_from_token(request)
    if not user or not is_admin(user.id):
        return jsonify({"error": "Forbidden"}), 403

    try:
        supabase_admin.table("coupons").delete().eq("id", coupon_id).execute()
        return jsonify({"message": "Coupon deleted"}), 200
    except Exception as e:
        return jsonify({"error": f"An unknown error occurred: {str(e)}"}), 500


@app.route("/api/upload", methods=["POST"])
def upload_image():
    session_id = request.headers.get("X-Guest-Session-ID")
    if not session_id:
        return jsonify({"error": "Unauthorized"}), 401

    if 'file' not in request.files:
        return jsonify({"error": "No file part in the request"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    try:
        upload_result = cloudinary.uploader.upload(file)
        return jsonify({"url": upload_result.get("secure_url")}), 200
    except Exception as e:
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)
